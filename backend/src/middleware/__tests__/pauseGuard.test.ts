import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

// pauseGuard.ts talks to the database via query() (to load/persist pause
// state) and to logger — mock both so these tests exercise only the
// guard's own decision logic.
const mockQuery = jest.fn();
jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
}));

// Redis mirror of the pause state, faked in memory so tests control outages.
const fakeCache = new Map<string, unknown>();
const mockCache = {
  get: jest.fn(async (key: string) => fakeCache.get(key) ?? null),
  set: jest.fn(async (key: string, value: unknown) => {
    fakeCache.set(key, value);
  }),
};
jest.unstable_mockModule('../../services/cacheService.js', () => ({
  cacheService: mockCache,
}));

const mockSentry = { captureMessage: jest.fn() };
jest.unstable_mockModule('../../config/sentry.js', () => ({ Sentry: mockSentry }));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: mockLogger,
}));

const { pauseGuard, setPauseState, getCurrentPauseState, PAUSE_STATE_CACHE_KEY } =
  await import('../pauseGuard.js');
const { AppError } = await import('../../errors/AppError.js');

describe('pauseGuard middleware (#1521)', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });

    // Reset the module's in-memory pause state to "not paused" between
    // tests via the same code path production uses (setPauseState), since
    // globalPauseState is private module state with no direct reset hook.
    await setPauseState(false, []);
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });

    mockRequest = { method: 'POST', path: '/api/loans/repay' };
    mockResponse = {};
    mockNext = jest.fn();
  });

  describe('when paused', () => {
    beforeEach(async () => {
      await setPauseState(true, ['CONTRACT_A', 'CONTRACT_B'], 'Security incident');
      jest.clearAllMocks();
    });

    it('blocks a POST (write) request with a 503 AppError', () => {
      expect(() => pauseGuard(mockRequest as Request, mockResponse as Response, mockNext)).toThrow(
        AppError,
      );

      try {
        pauseGuard(mockRequest as Request, mockResponse as Response, mockNext);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as InstanceType<typeof AppError>).statusCode).toBe(503);
        expect((err as InstanceType<typeof AppError>).message).toContain('Security incident');
        expect((err as InstanceType<typeof AppError>).message).toContain('CONTRACT_A');
      }

      expect(mockNext).not.toHaveBeenCalled();
    });

    it('blocks PUT, PATCH, and DELETE the same as POST', () => {
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const req = { ...mockRequest, method } as Request;
        expect(() => pauseGuard(req, mockResponse as Response, mockNext)).toThrow(AppError);
      }
    });

    it('still allows GET requests through', () => {
      const req = { ...mockRequest, method: 'GET' } as Request;
      pauseGuard(req, mockResponse as Response, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('still allows HEAD and OPTIONS requests through (read-only bypass)', () => {
      for (const method of ['HEAD', 'OPTIONS']) {
        const req = { ...mockRequest, method } as Request;
        const next = jest.fn();
        pauseGuard(req, mockResponse as Response, next);
        expect(next).toHaveBeenCalledWith();
      }
    });

    it('logs a warning identifying the blocked request and pause reason', () => {
      try {
        pauseGuard(mockRequest as Request, mockResponse as Response, mockNext);
      } catch {
        // expected — asserted separately above
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Request rejected due to contract pause',
        expect.objectContaining({
          method: 'POST',
          path: '/api/loans/repay',
          contracts: ['CONTRACT_A', 'CONTRACT_B'],
          reason: 'Security incident',
        }),
      );
    });
  });

  describe('when not paused', () => {
    it('allows a POST (write) request through', () => {
      pauseGuard(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('allows GET requests through', () => {
      const req = { ...mockRequest, method: 'GET' } as Request;
      pauseGuard(req, mockResponse as Response, mockNext);
      expect(mockNext).toHaveBeenCalledWith();
    });

    it('does not log a warning', () => {
      pauseGuard(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('setPauseState', () => {
    it('updates the in-memory pause state read by pauseGuard', async () => {
      await setPauseState(true, ['CONTRACT_X'], 'Upgrade in progress');

      expect(getCurrentPauseState()).toEqual(
        expect.objectContaining({
          isPaused: true,
          contracts: ['CONTRACT_X'],
          reason: 'Upgrade in progress',
        }),
      );

      expect(() => pauseGuard(mockRequest as Request, mockResponse as Response, mockNext)).toThrow(
        AppError,
      );
    });

    it('persists the new state via query()', async () => {
      await setPauseState(true, ['CONTRACT_X'], 'Upgrade in progress');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pause_state'),
        expect.arrayContaining([true, expect.any(Date), 'Upgrade in progress']),
      );
    });
  });

  describe('database outage handling (#504)', () => {
    type Guard = typeof import('../pauseGuard.js');

    /** A pristine copy of the module: nothing loaded, no alert raised yet. */
    async function freshGuard(): Promise<Guard> {
      jest.resetModules();
      return (await import('../pauseGuard.js')) as Guard;
    }

    const write = (): Request => ({ method: 'POST', path: '/api/loans/repay' }) as Request;
    const read = (): Request => ({ method: 'GET', path: '/api/loans' }) as Request;

    beforeEach(() => {
      fakeCache.clear();
      mockCache.get.mockImplementation(async (key: string) => fakeCache.get(key) ?? null);
      mockCache.set.mockImplementation(async (key: string, value: unknown) => {
        fakeCache.set(key, value);
      });
      mockQuery.mockRejectedValue(new Error('connection refused'));
    });

    describe('initial load fails', () => {
      it('fails closed: blocks writes, still serves reads', async () => {
        const guard = await freshGuard();
        await guard.updatePauseStateFromDatabase();

        expect(guard.getCurrentPauseState()).toEqual(
          expect.objectContaining({ isPaused: true, source: 'fail-closed' }),
        );
        expect(() => guard.pauseGuard(write(), mockResponse as Response, mockNext)).toThrow(
          expect.objectContaining({ statusCode: 503 }),
        );
        expect(mockNext).not.toHaveBeenCalled();

        guard.pauseGuard(read(), mockResponse as Response, mockNext);
        expect(mockNext).toHaveBeenCalledWith();
      });

      it('explains in the 503 why writes are blocked', async () => {
        const guard = await freshGuard();
        await guard.updatePauseStateFromDatabase();

        expect(() => guard.pauseGuard(write(), mockResponse as Response, mockNext)).toThrow(
          expect.objectContaining({
            message: expect.stringContaining('could not be verified'),
          }),
        );
      });

      it('uses the Redis copy of the pause state when there is one', async () => {
        fakeCache.set(PAUSE_STATE_CACHE_KEY, {
          isPaused: true,
          pausedAt: '2026-01-01T00:00:00.000Z',
          reason: 'Security incident',
          contracts: ['CONTRACT_A'],
          cachedAt: '2026-01-01T00:00:01.000Z',
        });
        const guard = await freshGuard();
        await guard.updatePauseStateFromDatabase();

        expect(guard.getCurrentPauseState()).toEqual(
          expect.objectContaining({
            isPaused: true,
            source: 'cache',
            reason: 'Security incident',
            contracts: ['CONTRACT_A'],
            pausedAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        );
        expect(() => guard.pauseGuard(write(), mockResponse as Response, mockNext)).toThrow(
          expect.objectContaining({ statusCode: 503 }),
        );
      });

      it('lets writes through when Redis says nothing is paused', async () => {
        fakeCache.set(PAUSE_STATE_CACHE_KEY, {
          isPaused: false,
          pausedAt: null,
          reason: null,
          contracts: [],
          cachedAt: '2026-01-01T00:00:01.000Z',
        });
        const guard = await freshGuard();
        await guard.updatePauseStateFromDatabase();

        expect(guard.getCurrentPauseState()).toEqual(
          expect.objectContaining({ isPaused: false, source: 'cache' }),
        );
        guard.pauseGuard(write(), mockResponse as Response, mockNext);
        expect(mockNext).toHaveBeenCalledWith();
      });

      it('ignores a malformed Redis entry and fails closed', async () => {
        fakeCache.set(PAUSE_STATE_CACHE_KEY, { unexpected: true });
        const guard = await freshGuard();
        await guard.updatePauseStateFromDatabase();

        expect(guard.getCurrentPauseState().source).toBe('fail-closed');
      });

      it('does not wait on a hung Redis: fails closed within the cache timeout', async () => {
        mockCache.get.mockImplementation(() => new Promise(() => undefined));
        const guard = await freshGuard();

        const started = Date.now();
        await guard.updatePauseStateFromDatabase();

        expect(Date.now() - started).toBeLessThan(2000);
        expect(guard.getCurrentPauseState().source).toBe('fail-closed');
      });
    });

    describe('after a successful load', () => {
      it('mirrors the state read from the database to Redis', async () => {
        mockQuery.mockResolvedValue({
          rows: [
            {
              is_paused: true,
              paused_at: new Date('2026-02-02T00:00:00.000Z'),
              reason: 'Upgrade',
              contracts: ['CONTRACT_B'],
            },
          ],
        });
        const guard = await freshGuard();
        await guard.updatePauseStateFromDatabase();

        expect(guard.getCurrentPauseState()).toEqual(
          expect.objectContaining({ isPaused: true, source: 'database' }),
        );
        expect(mockCache.set).toHaveBeenCalledWith(
          PAUSE_STATE_CACHE_KEY,
          expect.objectContaining({
            isPaused: true,
            reason: 'Upgrade',
            contracts: ['CONTRACT_B'],
            pausedAt: '2026-02-02T00:00:00.000Z',
          }),
          expect.any(Number),
        );
      });

      it('treats a reachable database with no pause record as not paused', async () => {
        mockQuery.mockResolvedValue({ rows: [] });
        const guard = await freshGuard();
        await guard.updatePauseStateFromDatabase();

        expect(guard.getCurrentPauseState()).toEqual(
          expect.objectContaining({ isPaused: false, source: 'database' }),
        );
      });

      it('keeps working when Redis is down while the database is fine', async () => {
        mockQuery.mockResolvedValue({ rows: [] });
        mockCache.set.mockRejectedValue(new Error('redis down'));
        const guard = await freshGuard();

        await expect(guard.updatePauseStateFromDatabase()).resolves.toBeUndefined();
        expect(guard.getCurrentPauseState().source).toBe('database');
      });

      it('keeps the last known state when the database later fails and Redis is empty', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ is_paused: true, paused_at: null, reason: 'Incident', contracts: [] }],
        });
        const guard = await freshGuard();
        await guard.updatePauseStateFromDatabase();
        fakeCache.clear(); // Redis lost its copy (eviction, restart)

        await guard.updatePauseStateFromDatabase(); // rejects

        expect(guard.getCurrentPauseState()).toEqual(
          expect.objectContaining({ isPaused: true, reason: 'Incident', source: 'memory' }),
        );
      });

      it('never lifts a known pause because Redis holds an older "not paused"', async () => {
        mockQuery.mockResolvedValueOnce({
          rows: [{ is_paused: true, paused_at: null, reason: 'Incident', contracts: [] }],
        });
        const guard = await freshGuard();
        await guard.updatePauseStateFromDatabase();
        fakeCache.set(PAUSE_STATE_CACHE_KEY, {
          isPaused: false,
          pausedAt: null,
          reason: null,
          contracts: [],
          cachedAt: '2025-01-01T00:00:00.000Z',
        });

        await guard.updatePauseStateFromDatabase(); // rejects

        expect(guard.getCurrentPauseState()).toEqual(
          expect.objectContaining({ isPaused: true, source: 'memory' }),
        );
      });

      it('returns to the database as the source once it recovers', async () => {
        const guard = await freshGuard();
        await guard.updatePauseStateFromDatabase(); // fails closed
        expect(guard.getCurrentPauseState().source).toBe('fail-closed');

        mockQuery.mockResolvedValue({
          rows: [{ is_paused: false, paused_at: null, reason: null, contracts: [] }],
        });
        await guard.updatePauseStateFromDatabase();

        expect(guard.getCurrentPauseState()).toEqual(
          expect.objectContaining({ isPaused: false, source: 'database' }),
        );
        guard.pauseGuard(write(), mockResponse as Response, mockNext);
        expect(mockNext).toHaveBeenCalledWith();
      });
    });

    describe('alerting', () => {
      it('alerts when the guard falls back to a non-database source', async () => {
        const guard = await freshGuard();
        await guard.updatePauseStateFromDatabase();

        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining('pause guard is not using the database'),
          expect.objectContaining({ alert: 'pause_guard_fallback', source: 'fail-closed' }),
        );
        expect(mockSentry.captureMessage).toHaveBeenCalledWith(
          expect.stringContaining('pause guard is not using the database'),
          expect.objectContaining({
            level: 'error',
            tags: { alert: 'pause_guard_fallback', source: 'fail-closed' },
          }),
        );
      });

      it('alerts once per outage, not on every refresh', async () => {
        const guard = await freshGuard();
        await guard.updatePauseStateFromDatabase();
        await guard.updatePauseStateFromDatabase();
        await guard.updatePauseStateFromDatabase();

        expect(mockSentry.captureMessage).toHaveBeenCalledTimes(1);
      });

      it('alerts again for a new outage after recovery, and says it recovered', async () => {
        const guard = await freshGuard();
        await guard.updatePauseStateFromDatabase();
        expect(mockSentry.captureMessage).toHaveBeenCalledTimes(1);

        mockQuery.mockResolvedValueOnce({ rows: [] });
        await guard.updatePauseStateFromDatabase();
        expect(mockLogger.info).toHaveBeenCalledWith(
          'Pause guard is reading from the database again',
          expect.objectContaining({ previous: 'fail-closed' }),
        );

        await guard.updatePauseStateFromDatabase(); // rejects again
        expect(mockSentry.captureMessage).toHaveBeenCalledTimes(2);
      });

      it('does not alert while the database is healthy', async () => {
        mockQuery.mockResolvedValue({ rows: [] });
        const guard = await freshGuard();
        await guard.updatePauseStateFromDatabase();

        expect(mockSentry.captureMessage).not.toHaveBeenCalled();
      });
    });

    describe('setPauseState when the database is down', () => {
      it('still enforces a pause that could not be persisted, and reports the failure', async () => {
        const guard = await freshGuard();

        await expect(guard.setPauseState(true, ['CONTRACT_A'], 'Incident')).rejects.toThrow(
          'connection refused',
        );

        expect(guard.getCurrentPauseState()).toEqual(
          expect.objectContaining({ isPaused: true, source: 'memory', reason: 'Incident' }),
        );
        expect(() => guard.pauseGuard(write(), mockResponse as Response, mockNext)).toThrow(
          expect.objectContaining({ statusCode: 503 }),
        );
        expect(mockCache.set).toHaveBeenCalledWith(
          PAUSE_STATE_CACHE_KEY,
          expect.objectContaining({ isPaused: true }),
          expect.any(Number),
        );
      });

      it('persists a pause that could not be saved once the database recovers, instead of lifting it', async () => {
        const guard = await freshGuard();
        await expect(guard.setPauseState(true, ['CONTRACT_A'], 'Incident')).rejects.toThrow();

        // Database is back, but its row still says "not paused".
        mockQuery.mockReset();
        mockQuery.mockImplementation(async (sql: string) =>
          sql.includes('SELECT')
            ? { rows: [{ is_paused: false, paused_at: null, reason: null, contracts: [] }] }
            : { rows: [] },
        );
        await guard.updatePauseStateFromDatabase();

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO pause_state'),
          expect.arrayContaining([true, 'Incident']),
        );
        expect(guard.getCurrentPauseState()).toEqual(
          expect.objectContaining({ isPaused: true, source: 'database', reason: 'Incident' }),
        );
        expect(fakeCache.get(PAUSE_STATE_CACHE_KEY)).toEqual(
          expect.objectContaining({ isPaused: true }),
        );
      });

      it('keeps enforcing an unsaved pause when the database is reachable but the write still fails', async () => {
        const guard = await freshGuard();
        await expect(guard.setPauseState(true, ['CONTRACT_A'], 'Incident')).rejects.toThrow();

        mockQuery.mockReset();
        mockQuery.mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT')) {
            return { rows: [{ is_paused: false, paused_at: null, reason: null, contracts: [] }] };
          }
          throw new Error('read-only replica');
        });
        await guard.updatePauseStateFromDatabase();

        expect(guard.getCurrentPauseState().isPaused).toBe(true);
      });

      it('stops retrying once the database itself records the pause', async () => {
        const guard = await freshGuard();
        await expect(guard.setPauseState(true, ['CONTRACT_A'], 'Incident')).rejects.toThrow();

        mockQuery.mockReset();
        mockQuery.mockResolvedValue({
          rows: [{ is_paused: true, paused_at: null, reason: 'Incident', contracts: [] }],
        });
        await guard.updatePauseStateFromDatabase();

        expect(mockQuery).toHaveBeenCalledTimes(1); // just the SELECT, no re-write
        expect(guard.getCurrentPauseState().source).toBe('database');
      });

      it('does not lift a pause it could not persist', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });
        const guard = await freshGuard();
        await guard.setPauseState(true, ['CONTRACT_A'], 'Incident');
        mockQuery.mockRejectedValue(new Error('connection refused'));

        await expect(guard.setPauseState(false, [])).rejects.toThrow('connection refused');

        expect(guard.getCurrentPauseState().isPaused).toBe(true);
      });
    });

    describe('reporting the source', () => {
      it('health is ok from the database, degraded on any fallback, unknown before loading', async () => {
        const guard = await freshGuard();
        expect(guard.getPauseGuardHealth()).toEqual(
          expect.objectContaining({ status: 'unknown', source: 'unloaded' }),
        );

        await guard.updatePauseStateFromDatabase();
        expect(guard.getPauseGuardHealth()).toEqual(
          expect.objectContaining({ status: 'degraded', source: 'fail-closed', isPaused: true }),
        );

        mockQuery.mockResolvedValue({ rows: [] });
        await guard.updatePauseStateFromDatabase();
        expect(guard.getPauseGuardHealth()).toEqual(
          expect.objectContaining({ status: 'ok', source: 'database', isPaused: false }),
        );
      });

      it('GET /api/status/pause reports the source and whether it is stale', async () => {
        const guard = await freshGuard();
        const res = { json: jest.fn() } as unknown as Response;

        await guard.getPauseState({} as Request, res, mockNext);

        expect(res.json).toHaveBeenCalledWith({
          success: true,
          data: expect.objectContaining({
            isPaused: true,
            source: 'fail-closed',
            stale: true,
          }),
        });
      });
    });
  });
});
