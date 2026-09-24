/**
 * Tenant-isolation and RBAC tests for wallet-scoped read routes (Issue #410 / #411).
 *
 * Uses the real Express score router + full JWT/RBAC middleware chain while
 * mocking the score controller and DB, so the assertions target authorization
 * (who may reach whose wallet) rather than score computation:
 *
 *   - borrower: only its own wallet
 *   - agent:    only assigned borrowers (+ own wallet)
 *   - admin/auditor: any wallet
 *   - never a 500 from a forged/over-scoped claim
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

jest.unstable_mockModule('../controllers/scoreController.js', () => ({
  getScore: jest.fn((_req: Request, res: Response) =>
    res.json({ success: true, data: { score: 720 } }),
  ),
  getScoreBreakdown: jest.fn((_req: Request, res: Response) =>
    res.json({ success: true, data: { factors: [] } }),
  ),
  getOnChainScoreHistory: jest.fn((_req: Request, res: Response) =>
    res.json({ success: true, data: [] }),
  ),
  getRemittanceNft: jest.fn((_req: Request, res: Response) =>
    res.json({ success: true, data: { nft: null } }),
  ),
  getLeaderboard: jest.fn((_req: Request, res: Response) => res.json({ success: true, data: [] })),
  updateScore: jest.fn((_req: Request, res: Response) =>
    res.json({ success: true, data: { score: 1 } }),
  ),
}));

const mockQuery = jest.fn(async () => ({ rows: [], rowCount: 0 }));

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
}));

const { default: scoreRoutes } = await import('../routes/scoreRoutes.js');
const { errorHandler } = await import('../middleware/errorHandler.js');
const { generateJwtToken } = await import('../services/authService.js');

const BORROWER = 'GBORROWERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BORROWER2 = 'GBORROWER2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const AGENT = 'GAGENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ADMIN = 'GADMINAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const AUDITOR = 'GAUDITORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const originalEnv = { ...process.env };

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/score', scoreRoutes);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    errorHandler(err, _req, res, _next);
  });
  return app;
}

const get = (path: string, token?: string) => {
  const req = request(buildApp()).get(path);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
};

describe('Tenant isolation on wallet-scoped score routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockClear();
    process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
    process.env.ADMIN_WALLETS = ADMIN;
    process.env.AGENT_WALLETS = AGENT;
    process.env.AUDITOR_WALLETS = AUDITOR;
    process.env.LENDER_WALLETS = '';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('401 without a JWT', async () => {
    const res = await get(`/api/score/${BORROWER}`);
    expect(res.status).toBe(401);
  });

  describe('borrower role', () => {
    it('reads its own wallet', async () => {
      const res = await get(`/api/score/${BORROWER}`, generateJwtToken(BORROWER));
      expect(res.status).toBe(200);
    });

    it('is blocked (403) from another borrower wallet', async () => {
      const res = await get(`/api/score/${BORROWER2}`, generateJwtToken(BORROWER));
      expect(res.status).toBe(403);
    });

    it('is blocked (403) from an agent wallet', async () => {
      const res = await get(`/api/score/${AGENT}`, generateJwtToken(BORROWER));
      expect(res.status).toBe(403);
    });
  });

  describe('agent role', () => {
    it('reads its own wallet', async () => {
      const res = await get(`/api/score/${AGENT}`, generateJwtToken(AGENT));
      expect(res.status).toBe(200);
    });

    it('reads borrowers explicitly assigned to it (JWT claim)', async () => {
      const token = generateJwtToken(AGENT, { assignedBorrowers: [BORROWER2] });
      const res = await get(`/api/score/${BORROWER2}`, token);
      expect(res.status).toBe(200);
    });

    it('is blocked (403) from an unassigned borrower', async () => {
      // No assignedBorrowers claim and no rows in agent_assignments → denied.
      const res = await get(`/api/score/${BORROWER2}`, generateJwtToken(AGENT));
      expect(res.status).toBe(403);
    });

    it('is blocked (403) from another agent wallet', async () => {
      const res = await get(`/api/score/${BORROWER2}`, generateJwtToken(AGENT));
      expect(res.status).toBe(403);
    });
  });

  describe('admin role', () => {
    it('reads any wallet', async () => {
      for (const target of [BORROWER, BORROWER2, AGENT]) {
        const res = await get(`/api/score/${target}`, generateJwtToken(ADMIN));
        expect(res.status).toBe(200);
      }
    });
  });

  describe('auditor role', () => {
    it('reads any wallet (read-only elevation)', async () => {
      const res = await get(`/api/score/${BORROWER}`, generateJwtToken(AUDITOR));
      expect(res.status).toBe(200);
    });
  });

  describe('JWT claims are re-capped to the wallet role', () => {
    it('treats a wallet from neither list as borrower (least privilege)', async () => {
      const unknown = 'GUNKNOWNAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const res = await get(`/api/score/${BORROWER}`, generateJwtToken(unknown));
      expect(res.status).toBe(403);
    });

    it('rejects a forged admin:all token minted for an agent wallet (role re-cap)', async () => {
      const { default: jwt } = await import('jsonwebtoken');
      const forged = jwt.sign(
        { publicKey: AGENT, role: 'admin', scopes: ['admin:all'] },
        process.env.JWT_SECRET!,
        { expiresIn: '1h', algorithm: 'HS256' },
      );
      const res = await get(`/api/score/${BORROWER}`, forged);
      expect(res.status).toBe(403);
    });
  });

  describe('history routes inherit the same tenant gate', () => {
    it('blocks a borrower from another wallet on score history', async () => {
      const res = await get(`/api/score/${BORROWER2}/history`, generateJwtToken(BORROWER));
      expect(res.status).toBe(403);
    });

    it('allows an agent reading an assigned borrower history', async () => {
      const token = generateJwtToken(AGENT, { assignedBorrowers: [BORROWER] });
      const res = await get(`/api/score/${BORROWER}/history`, token);
      expect(res.status).toBe(200);
    });
  });
});
