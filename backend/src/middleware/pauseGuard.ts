import type { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger.js';
import { AppError } from '../errors/AppError.js';
import { query } from '../db/connection.js';
import { cacheService } from '../services/cacheService.js';
import { Sentry } from '../config/sentry.js';
import { pauseGuardFallbackTotal, pauseGuardSource } from '../metrics/index.js';

/**
 * Where the guard's current answer came from.
 *
 * - `database`    — read from (or just written to) the `pause_state` table. Authoritative.
 * - `cache`       — the database was unreachable; the last state mirrored to Redis was used.
 * - `memory`      — the database and Redis were unreachable; the last state this process
 *                   knew about is being kept.
 * - `fail-closed` — a load failed and no earlier state is known; writes are blocked.
 * - `unloaded`    — no load has been attempted yet (only before `initializePauseState`).
 */
export type PauseStateSource = 'database' | 'cache' | 'memory' | 'fail-closed' | 'unloaded';

const ALL_SOURCES: readonly PauseStateSource[] = [
  'database',
  'cache',
  'memory',
  'fail-closed',
  'unloaded',
];

/** Redis key under which the last known pause state is mirrored. */
export const PAUSE_STATE_CACHE_KEY = 'pause_state:global';
/** Long enough to outlive a database outage; rewritten on every successful load. */
const PAUSE_STATE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Redis is a fallback; never let a slow or hung Redis stall a pause update or refresh. */
const CACHE_TIMEOUT_MS = 250;

async function withCacheTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('pause state cache timeout')), CACHE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const UNVERIFIED_REASON = 'Pause state could not be verified (database unavailable)';

/**
 * Tracks the global pause state across all contracts.
 * Updated via event indexer when pause/unpause events are detected.
 */
interface PauseState {
  isPaused: boolean;
  pausedAt: Date | null;
  reason: string | null;
  contracts: string[];
  source: PauseStateSource;
  /** When this answer was last confirmed by its source. */
  verifiedAt: Date | null;
}

/**
 * Nothing has been loaded until `initializePauseState` runs, and it always runs
 * before the server accepts traffic. What matters is what happens when a load
 * FAILS: `fallBackFromDatabase` then blocks writes (fail closed) rather than
 * assuming "not paused".
 */
let globalPauseState: PauseState = {
  isPaused: false,
  pausedAt: null,
  reason: null,
  contracts: [],
  source: 'unloaded',
  verifiedAt: null,
};

/**
 * A pause that could not be written to the database (it was enforced from
 * memory instead). While set, a database refresh that still reads "not paused"
 * must not lift it: the pause is written to the database first.
 */
let pendingPause: { reason: string | null; contracts: string[] } | null = null;

/** Source we last raised an alert for, so a long outage alerts once, not every refresh. */
let alertedSource: PauseStateSource | null = null;

function publishSourceMetric(source: PauseStateSource): void {
  for (const candidate of ALL_SOURCES) {
    pauseGuardSource.set({ source: candidate }, candidate === source ? 1 : 0);
  }
}

/** Shape stored in Redis (dates as ISO strings). */
interface CachedPauseState {
  isPaused: boolean;
  pausedAt: string | null;
  reason: string | null;
  contracts: string[];
  cachedAt: string;
}

function applyState(next: Omit<PauseState, 'verifiedAt'>): void {
  globalPauseState = { ...next, verifiedAt: new Date() };
  publishSourceMetric(next.source);

  if (next.source === 'database') {
    if (alertedSource !== null) {
      logger.info('Pause guard is reading from the database again', { previous: alertedSource });
      alertedSource = null;
    }
    return;
  }
  raiseFallbackAlert(next.source);
}

/**
 * Alert (once per distinct fallback source) that the guard is no longer
 * reading the database: the pause state it enforces may be stale.
 */
function raiseFallbackAlert(source: PauseStateSource): void {
  pauseGuardFallbackTotal.inc({ source });
  if (alertedSource === source) {
    return;
  }
  alertedSource = source;

  const message = `ALERT: pause guard is not using the database (source: ${source})`;
  logger.error(message, {
    alert: 'pause_guard_fallback',
    source,
    isPaused: globalPauseState.isPaused,
  });
  Sentry.captureMessage(message, {
    level: 'error',
    tags: { alert: 'pause_guard_fallback', source },
    extra: { isPaused: globalPauseState.isPaused },
  });
}

async function mirrorToCache(state: {
  isPaused: boolean;
  pausedAt: Date | null;
  reason: string | null;
  contracts: string[];
}): Promise<void> {
  const cached: CachedPauseState = {
    isPaused: state.isPaused,
    pausedAt: state.pausedAt ? new Date(state.pausedAt).toISOString() : null,
    reason: state.reason,
    contracts: state.contracts,
    cachedAt: new Date().toISOString(),
  };
  try {
    await withCacheTimeout(
      cacheService.set(PAUSE_STATE_CACHE_KEY, cached, PAUSE_STATE_CACHE_TTL_SECONDS),
    );
  } catch (error) {
    // The mirror is only a fallback; never let it fail the primary path.
    logger.warn('Failed to mirror pause state to cache', { error });
  }
}

async function readFromCache(): Promise<CachedPauseState | null> {
  try {
    const cached = await withCacheTimeout(
      cacheService.get<CachedPauseState>(PAUSE_STATE_CACHE_KEY),
    );
    return cached && typeof cached.isPaused === 'boolean' ? cached : null;
  } catch {
    return null;
  }
}

/**
 * The database could not be read. Pick the safest answer available:
 *  1. the state mirrored in Redis,
 *  2. otherwise the last state this process knew,
 *  3. otherwise fail closed (paused).
 * A fallback may keep or add a pause but never lifts one: if the state we
 * already hold says paused and the fallback says not paused, the pause stays.
 */
async function fallBackFromDatabase(error: unknown): Promise<void> {
  logger.error('Failed to update pause state from database', { error });

  const known = globalPauseState;
  const cached = await readFromCache();

  if (cached) {
    const knownIsReal =
      known.source === 'database' || known.source === 'cache' || known.source === 'memory';
    if (known.isPaused && !cached.isPaused && knownIsReal) {
      applyState({ ...known, source: 'memory' });
      return;
    }
    applyState({
      isPaused: cached.isPaused,
      pausedAt: cached.pausedAt ? new Date(cached.pausedAt) : null,
      reason: cached.reason,
      contracts: cached.contracts ?? [],
      source: 'cache',
    });
    return;
  }

  if (known.source === 'database' || known.source === 'cache' || known.source === 'memory') {
    applyState({ ...known, source: 'memory' });
    return;
  }

  applyState({
    isPaused: true,
    pausedAt: known.pausedAt,
    reason: UNVERIFIED_REASON,
    contracts: known.contracts,
    source: 'fail-closed',
  });
}

/**
 * Updates the global pause state from the database.
 * Called periodically and after pause/unpause events.
 */
export async function updatePauseStateFromDatabase(): Promise<void> {
  try {
    const result = await query(
      'SELECT is_paused, paused_at, reason, contracts FROM pause_state LIMIT 1',
    );

    const stored = result.rows[0] as { is_paused?: boolean } | undefined;
    if (pendingPause && !stored?.is_paused) {
      // The database still says "not paused" for a pause it never received.
      // Persist that pause now rather than letting the stale row lift it.
      const { contracts, reason } = pendingPause;
      try {
        await setPauseState(true, contracts, reason ?? undefined);
      } catch {
        // Still cannot persist; the in-memory pause stays enforced (and alerted on).
      }
      return;
    }
    pendingPause = null;

    if (result.rows.length > 0) {
      const row = result.rows[0] as {
        is_paused: boolean;
        paused_at: Date | null;
        reason: string | null;
        contracts: string[];
      };
      applyState({
        isPaused: row.is_paused,
        pausedAt: row.paused_at,
        reason: row.reason,
        contracts: row.contracts || [],
        source: 'database',
      });
    } else {
      // The database answered and holds no pause record: nothing is paused.
      applyState({
        isPaused: false,
        pausedAt: null,
        reason: null,
        contracts: [],
        source: 'database',
      });
    }
    await mirrorToCache(globalPauseState);
  } catch (error) {
    // Fail closed: never assume "not paused" just because we couldn't ask.
    await fallBackFromDatabase(error);
  }
}

/**
 * Middleware to enforce pause state on state-mutating operations.
 * Rejects write requests (POST, PUT, PATCH, DELETE) when contracts are paused.
 *
 * Returns:
 * - 200 with pause state info on GET requests (read-only, allowed)
 * - 200 with pause state info on OPTIONS requests (allowed)
 * - 503 Service Unavailable if mutating request during pause
 */
export function pauseGuard(req: Request, _res: Response, next: NextFunction): void {
  // Allow read-only operations
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  // Check if contracts are paused
  if (globalPauseState.isPaused) {
    logger.warn('Request rejected due to contract pause', {
      method: req.method,
      path: req.path,
      contracts: globalPauseState.contracts,
      reason: globalPauseState.reason,
    });

    // Return 503 Service Unavailable with pause info
    throw AppError.serviceUnavailable(
      `Contract operations are temporarily paused. Reason: ${globalPauseState.reason || 'Maintenance or security measure'}. ` +
        `Affected contracts: ${globalPauseState.contracts.join(', ')}`,
    );
  }

  next();
}

/**
 * Endpoint to check current pause state.
 * Available to all clients without authentication.
 */
export async function getPauseState(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Refresh pause state from database
    await updatePauseStateFromDatabase();

    res.json({
      success: true,
      data: {
        isPaused: globalPauseState.isPaused,
        pausedAt: globalPauseState.pausedAt,
        reason: globalPauseState.reason,
        contracts: globalPauseState.contracts,
        source: globalPauseState.source,
        stale: globalPauseState.source !== 'database',
        verifiedAt: globalPauseState.verifiedAt,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Called by eventIndexer when pause events are detected on any contract.
 * Updates database and global state.
 */
export async function setPauseState(
  isPaused: boolean,
  contracts: string[],
  reason?: string,
): Promise<void> {
  try {
    const now = isPaused ? new Date() : null;

    // Upsert pause state in database
    await query(
      `INSERT INTO pause_state (id, is_paused, paused_at, reason, contracts, updated_at)
       VALUES (1, $1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE SET
         is_paused = $1,
         paused_at = $2,
         reason = $3,
         contracts = $4,
         updated_at = NOW()`,
      [isPaused, now, reason || null, JSON.stringify(contracts)],
    );

    pendingPause = null;
    // Update in-memory state
    applyState({ isPaused, pausedAt: now, reason: reason || null, contracts, source: 'database' });
    await mirrorToCache(globalPauseState);

    logger.info('Pause state updated', {
      isPaused,
      contracts,
      reason,
    });
  } catch (error) {
    logger.error('Failed to set pause state', { error, isPaused, contracts, reason });
    if (isPaused) {
      // A pause must be enforced even if it could not be persisted. Lifting one
      // that could not be persisted is not applied: the guard stays as it was.
      const pausedAt = new Date();
      pendingPause = { reason: reason || null, contracts };
      applyState({ isPaused, pausedAt, reason: reason || null, contracts, source: 'memory' });
      await mirrorToCache(globalPauseState);
    }
    throw error;
  }
}

/**
 * Initialize pause state from database on startup.
 */
export async function initializePauseState(): Promise<void> {
  try {
    // Create pause_state table if it doesn't exist
    await query(
      `CREATE TABLE IF NOT EXISTS pause_state (
        id BIGINT PRIMARY KEY,
        is_paused BOOLEAN NOT NULL DEFAULT false,
        paused_at TIMESTAMP WITH TIME ZONE,
        reason TEXT,
        contracts TEXT[] DEFAULT '{}',
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )`,
    );

    // Ensure we have exactly one row
    await query(
      `INSERT INTO pause_state (id, is_paused, paused_at, reason, contracts, updated_at)
       VALUES (1, false, NULL, NULL, '{}', NOW())
       ON CONFLICT (id) DO NOTHING`,
    );

    // Load initial state
    await updatePauseStateFromDatabase();

    logger.info('Pause guard initialized');
  } catch (error) {
    logger.error('Failed to initialize pause state', { error });
    throw error;
  }
}

/**
 * Get current pause state (for internal use).
 */
export function getCurrentPauseState(): PauseState {
  return globalPauseState;
}

/**
 * Health summary of the pause guard for `/health/deep`. `ok` while the state is
 * being read from the database; any fallback is `degraded` because the enforced
 * state may be stale; `unknown` before the first load.
 */
export function getPauseGuardHealth(): {
  status: 'ok' | 'degraded' | 'unknown';
  source: PauseStateSource;
  isPaused: boolean;
  verifiedAt: Date | null;
} {
  return {
    status:
      globalPauseState.source === 'database'
        ? 'ok'
        : globalPauseState.source === 'unloaded'
          ? 'unknown'
          : 'degraded',
    source: globalPauseState.source,
    isPaused: globalPauseState.isPaused,
    verifiedAt: globalPauseState.verifiedAt,
  };
}

let refreshTimer: NodeJS.Timeout | null = null;

/**
 * Re-read the pause state on an interval so a database outage (or recovery) is
 * noticed without waiting for someone to hit `/api/status/pause`. The timer
 * does not keep the process alive. `intervalMs <= 0` disables it.
 */
export function startPauseStateRefresh(intervalMs: number): void {
  stopPauseStateRefresh();
  if (!(intervalMs > 0)) {
    return;
  }
  refreshTimer = setInterval(() => {
    void updatePauseStateFromDatabase();
  }, intervalMs);
  refreshTimer.unref();
}

/** Stop the interval started by `startPauseStateRefresh`. */
export function stopPauseStateRefresh(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
