/**
 * Issue #518: rate limits on admin and score read endpoints that were
 * previously unthrottled (audit logs, disputes, governance queue, pool
 * analytics, credit scores).
 *
 * These mount the real routers, so they prove the limiter is wired into each
 * route, not merely that the limiter works in isolation. Authenticated
 * routes are limited per wallet; public ones per IP.
 *
 * The routers are mounted on a bare Express app rather than `app.ts` because
 * `app.ts` also applies the global 100-requests/15-minutes IP limiter, which
 * these many-request tests would exhaust before reaching the limits under test.
 */
import { jest, describe, it, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Keypair } from '@stellar/stellar-sdk';

const wallet = () => Keypair.random().publicKey();
const ADMINS = Array.from({ length: 12 }, wallet);
// requireJwtAuth re-resolves the role from the wallet allowlist, so admins must
// be registered before app.ts loads the rbac config.
process.env.ADMIN_WALLETS = ADMINS.join(',');
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-min-32-chars-long!!';

const mockDbQuery = jest
  .fn<(sql?: unknown) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>>()
  .mockResolvedValue({ rows: [], rowCount: 0 });
jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockDbQuery },
  query: mockDbQuery,
  getClient: jest.fn(),
  withTransaction: jest.fn(),
}));
jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  },
}));
jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
    healthCheck: jest.fn<() => Promise<{ connected: boolean }>>().mockResolvedValue({
      connected: true,
    }),
    getOnChainScoreHistory: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
    getRemittanceNftMetadata: jest.fn<() => Promise<null>>().mockResolvedValue(null),
  },
}));

const { userOrIpKey } = await import('../middleware/rateLimiter.js');
const { errorHandler } = await import('../middleware/errorHandler.js');
const { default: adminRoutes } = await import('../routes/adminRoutes.js');
const { default: poolRoutes } = await import('../routes/poolRoutes.js');
const { default: scoreRoutes } = await import('../routes/scoreRoutes.js');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);
app.use('/api/pool', poolRoutes);
app.use('/api/score', scoreRoutes);
app.use(errorHandler);

const tokenFor = (publicKey: string, role: string, scopes: string[]) =>
  jwt.sign({ publicKey, role, scopes }, process.env.JWT_SECRET as string, {
    expiresIn: '1h',
    algorithm: 'HS256',
  });
const adminToken = (publicKey: string) => tokenFor(publicKey, 'admin', ['admin:all']);

/** Send `count` GETs and return every status code, in order. */
async function hit(path: string, count: number, token?: string): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i++) {
    const req = request(app).get(path);
    if (token) req.set('Authorization', `Bearer ${token}`);
    statuses.push((await req).status);
  }
  return statuses;
}

/** Asserts the first `limit` calls got through and the next one was throttled. */
async function expectLimitOf(path: string, limit: number, token?: string): Promise<void> {
  const statuses = await hit(path, limit, token);
  expect(statuses).not.toContain(429);

  const over = token
    ? await request(app).get(path).set('Authorization', `Bearer ${token}`)
    : await request(app).get(path);
  expect(over.status).toBe(429);
  expect(over.headers['retry-after']).toBe('60');
  expect(over.body).toEqual({ success: false, message: expect.stringMatching(/Too many/) });
}

describe('userOrIpKey', () => {
  it('keys an authenticated request by wallet, ignoring its IP', () => {
    expect(userOrIpKey({ user: { publicKey: 'GABC' }, ip: '1.1.1.1' })).toBe('user:GABC');
    expect(userOrIpKey({ user: { publicKey: 'GABC' }, ip: '2.2.2.2' })).toBe('user:GABC');
  });

  it('keys an unauthenticated request by IP', () => {
    expect(userOrIpKey({ ip: '1.1.1.1' })).toBe('ip:1.1.1.1');
    expect(userOrIpKey({ user: {}, ip: '1.1.1.1' })).toBe('ip:1.1.1.1');
  });

  it('groups IPv6 addresses by their /56 rather than one address per key', () => {
    expect(userOrIpKey({ ip: '2001:db8:abcd:12::1' })).toBe(
      userOrIpKey({ ip: '2001:db8:abcd:12::ffff' }),
    );
  });

  it('does not throw when there is no IP', () => {
    expect(userOrIpKey({})).toMatch(/^ip:/);
  });
});

describe('admin read endpoints (per-admin limits)', () => {
  it('GET /api/admin/audit-logs: 30 per minute', async () => {
    await expectLimitOf('/api/admin/audit-logs', 30, adminToken(ADMINS[0]!));
  });

  it('GET /api/admin/disputes: 60 per minute', async () => {
    await expectLimitOf('/api/admin/disputes', 60, adminToken(ADMINS[1]!));
  });

  it('GET /api/admin/disputes/:disputeId: 60 per minute', async () => {
    await expectLimitOf('/api/admin/disputes/D-1', 60, adminToken(ADMINS[2]!));
  });

  it('GET /api/admin/governance/pending: 60 per minute', async () => {
    await expectLimitOf('/api/admin/governance/pending', 60, adminToken(ADMINS[3]!));
  });

  it('counts each admin separately: one being throttled does not affect another', async () => {
    const [first, second] = [ADMINS[4]!, ADMINS[5]!];
    await hit('/api/admin/audit-logs', 31, adminToken(first));
    expect((await hit('/api/admin/audit-logs', 1, adminToken(first)))[0]).toBe(429);

    expect((await hit('/api/admin/audit-logs', 1, adminToken(second)))[0]).not.toBe(429);
  });

  it('gives audit logs their own budget, separate from the other admin reads', async () => {
    const admin = ADMINS[6]!;
    await hit('/api/admin/audit-logs', 31, adminToken(admin));

    expect((await hit('/api/admin/audit-logs', 1, adminToken(admin)))[0]).toBe(429);
    expect((await hit('/api/admin/disputes', 1, adminToken(admin)))[0]).not.toBe(429);
    expect((await hit('/api/admin/governance/pending', 1, adminToken(admin)))[0]).not.toBe(429);
  });

  it('throttles a non-admin probing an admin endpoint before it can enumerate it', async () => {
    const probe = tokenFor(wallet(), 'borrower', ['read:loans']);

    const statuses = await hit('/api/admin/audit-logs', 31, probe);

    expect(statuses.slice(0, 30).every((s) => s === 403)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it('leaves unauthenticated requests to the auth layer (401), not the limiter', async () => {
    const statuses = await hit('/api/admin/audit-logs', 35);
    expect(statuses.every((s) => s === 401)).toBe(true);
  });
});

describe('public endpoints (per-IP limits)', () => {
  it('GET /api/pool/analytics: 60 per minute', async () => {
    await expectLimitOf('/api/pool/analytics', 60);
  });

  it('GET /api/score/leaderboard: 60 per minute', async () => {
    await expectLimitOf('/api/score/leaderboard', 60);
  });
});

describe('credit score endpoints (per-wallet limits)', () => {
  const borrower = () => {
    const publicKey = wallet();
    return { publicKey, token: tokenFor(publicKey, 'borrower', ['read:score']) };
  };

  it('GET /api/score/:userId: 60 per minute', async () => {
    const { publicKey, token } = borrower();
    await expectLimitOf(`/api/score/${publicKey}`, 60, token);
  });

  it('GET /api/score/:userId/breakdown: 60 per minute', async () => {
    const { publicKey, token } = borrower();
    await expectLimitOf(`/api/score/${publicKey}/breakdown`, 60, token);
  });

  it('GET /api/score/:walletAddress/history: 60 per minute', async () => {
    const { publicKey, token } = borrower();
    await expectLimitOf(`/api/score/${publicKey}/history`, 60, token);
  });

  it('GET /api/score/:walletAddress/nft: 60 per minute', async () => {
    const { publicKey, token } = borrower();
    await expectLimitOf(`/api/score/${publicKey}/nft`, 60, token);
  });

  it('throttles one wallet without affecting another', async () => {
    const a = borrower();
    const b = borrower();
    await hit(`/api/score/${a.publicKey}`, 61, a.token);

    expect((await hit(`/api/score/${a.publicKey}`, 1, a.token))[0]).toBe(429);
    expect((await hit(`/api/score/${b.publicKey}`, 1, b.token))[0]).not.toBe(429);
  });
});
