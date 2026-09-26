import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { AppError } from '../../errors/AppError.js';

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

// In-memory fake cache so revokeToken/isTokenRevoked actually persist state
// across requests within a test, the same way a real Redis blacklist would.
const fakeCacheStore = new Map<string, unknown>();
jest.unstable_mockModule('../../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn(async (key: string) => fakeCacheStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      fakeCacheStore.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      fakeCacheStore.delete(key);
    }),
  },
}));

const { generateJwtToken, revokeToken, revokeTokenFamily, decodeJwtToken } =
  await import('../../services/authService.js');
const { requireJwtAuth, optionalJwtAuth, requireScopes } = await import('../jwtAuth.js');

const buildApp = () => {
  const app = express();
  app.get('/admin-only', requireJwtAuth, requireScopes('admin:all'), (_req, res) =>
    res.status(200).json({ success: true }),
  );
  app.post('/echo', requireJwtAuth, (req, res) =>
    res.status(200).json({
      publicKey: (req as { user?: { publicKey: string } }).user?.publicKey,
    }),
  );
  app.get('/public', optionalJwtAuth, (req, res) =>
    res.status(200).json({
      publicKey: (req as { user?: { publicKey: string } }).user?.publicKey ?? null,
    }),
  );
  app.use((err: AppError, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode ?? 500).json({ success: false });
  });
  return app;
};

describe('JWT revocation and role-change propagation', () => {
  const ORIGINAL_ADMIN_WALLETS = process.env.ADMIN_WALLETS;

  beforeEach(() => {
    fakeCacheStore.clear();
    process.env.ADMIN_WALLETS = ORIGINAL_ADMIN_WALLETS;
  });

  it('rejects a token minted while admin, after the wallet is removed from ADMIN_WALLETS', async () => {
    const wallet = Keypair.random().publicKey();
    process.env.ADMIN_WALLETS = wallet;

    // Minted while the wallet was an admin — embeds scopes: ["admin:all"].
    const token = generateJwtToken(wallet);
    const app = buildApp();

    const beforeRemoval = await request(app)
      .get('/admin-only')
      .set('Authorization', `Bearer ${token}`);
    expect(beforeRemoval.status).toBe(200);

    // Wallet is revoked from the admin allowlist; no new token is issued.
    process.env.ADMIN_WALLETS = '';

    const afterRemoval = await request(app)
      .get('/admin-only')
      .set('Authorization', `Bearer ${token}`);

    expect(afterRemoval.status).toBe(403);
  });

  it("rejects a token immediately after logout, even though its role hasn't changed", async () => {
    const wallet = Keypair.random().publicKey();
    const token = generateJwtToken(wallet);
    const payload = decodeJwtToken(token);
    const app = buildApp();

    const beforeLogout = await request(app).post('/echo').set('Authorization', `Bearer ${token}`);
    expect(beforeLogout.status).toBe(200);

    await revokeToken(payload!.jti, payload!.exp);

    const afterLogout = await request(app).post('/echo').set('Authorization', `Bearer ${token}`);
    expect(afterLogout.status).toBe(401);
  });

  describe('token family revocation (replay detection)', () => {
    it('stops a revoked family on required-auth endpoints', async () => {
      const wallet = Keypair.random().publicKey();
      const token = generateJwtToken(wallet, { familyId: 'family-required' });
      const app = buildApp();

      await request(app).post('/echo').set('Authorization', `Bearer ${token}`).expect(200);

      await revokeTokenFamily('family-required', 'token_replay_detected');

      await request(app).post('/echo').set('Authorization', `Bearer ${token}`).expect(401);
    });

    it('stops a revoked family on optional-auth endpoints instead of authenticating it', async () => {
      const wallet = Keypair.random().publicKey();
      const token = generateJwtToken(wallet, { familyId: 'family-optional' });
      const app = buildApp();

      const before = await request(app).get('/public').set('Authorization', `Bearer ${token}`);
      expect(before.status).toBe(200);
      expect(before.body.publicKey).toBe(wallet);

      await revokeTokenFamily('family-optional', 'token_replay_detected');

      // Optional auth never rejects, but the revoked token must not authenticate.
      const after = await request(app).get('/public').set('Authorization', `Bearer ${token}`);
      expect(after.status).toBe(200);
      expect(after.body.publicKey).toBeNull();
    });

    it('only affects tokens in the revoked family', async () => {
      const wallet = Keypair.random().publicKey();
      const revoked = generateJwtToken(wallet, { familyId: 'family-a' });
      const sibling = generateJwtToken(wallet, { familyId: 'family-b' });
      const familyless = generateJwtToken(wallet);
      const app = buildApp();

      await revokeTokenFamily('family-a', 'token_replay_detected');

      const identity = async (token: string) =>
        (await request(app).get('/public').set('Authorization', `Bearer ${token}`)).body
          .publicKey as string | null;
      expect(await identity(revoked)).toBeNull();
      expect(await identity(sibling)).toBe(wallet);
      expect(await identity(familyless)).toBe(wallet);
    });

    it('treats required and optional auth the same for every revocation kind', async () => {
      const wallet = Keypair.random().publicKey();
      const byFamily = generateJwtToken(wallet, { familyId: 'family-same' });
      const byJti = generateJwtToken(wallet);
      await revokeTokenFamily('family-same', 'token_replay_detected');
      await revokeToken(decodeJwtToken(byJti)!.jti, decodeJwtToken(byJti)!.exp);
      const app = buildApp();

      for (const token of [byFamily, byJti]) {
        const required = await request(app).post('/echo').set('Authorization', `Bearer ${token}`);
        const optional = await request(app).get('/public').set('Authorization', `Bearer ${token}`);
        expect(required.status).toBe(401);
        expect(optional.body.publicKey).toBeNull();
      }
    });

    it('still authenticates an unrevoked token that carries a family', async () => {
      const wallet = Keypair.random().publicKey();
      const token = generateJwtToken(wallet, { familyId: 'family-healthy' });
      const app = buildApp();

      await request(app).post('/echo').set('Authorization', `Bearer ${token}`).expect(200);
      const res = await request(app).get('/public').set('Authorization', `Bearer ${token}`);
      expect(res.body.publicKey).toBe(wallet);
    });
  });
});
