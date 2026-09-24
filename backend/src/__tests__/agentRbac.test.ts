/**
 * Authorization tests for the agent routes (Issue #411 / #412).
 *
 * Exercises the full middleware chain (`requireJwtAuth` → `requireRole` →
 * handler) through the actual Express router: borrower JWTs must never reach
 * the assignment controller, agents may only read their own assignments, and
 * only admins may mutate the `agent_assignments` table.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const okHandler = (_req: Request, res: Response) => res.json({ success: true, data: {} });

jest.unstable_mockModule('../controllers/agentController.js', () => ({
  getMyAssignments: jest.fn((_req: Request, res: Response) =>
    res.json({ success: true, data: { agentPublicKey: 'X', assignments: [] } }),
  ),
  assignBorrower: jest.fn((_req: Request, res: Response) =>
    res.status(201).json({ success: true }),
  ),
  removeBorrower: jest.fn((_req: Request, res: Response) => res.json({ success: true })),
}));

jest.unstable_mockModule('../db/connection.js', () => ({
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
}));

const { default: agentRoutes } = await import('../routes/agentRoutes.js');
const { errorHandler } = await import('../middleware/errorHandler.js');
const { generateJwtToken } = await import('../services/authService.js');

const ADMIN = 'GADMINAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const AGENT = 'GAGENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BORROWER = 'GBORROWERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const originalEnv = { ...process.env };

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentRoutes);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    errorHandler(err, _req, res, _next);
  });
  return app;
}

function adminToken(): string {
  return generateJwtToken(ADMIN);
}

function agentToken(): string {
  return generateJwtToken(AGENT);
}

function borrowerToken(): string {
  return generateJwtToken(BORROWER);
}

describe('Agent route RBAC', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
    process.env.ADMIN_WALLETS = ADMIN;
    process.env.AGENT_WALLETS = AGENT;
    process.env.AUDITOR_WALLETS = '';
    process.env.LENDER_WALLETS = '';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('GET /api/agents/my-assignments', () => {
    it('returns assignments for an agent JWT', async () => {
      const res = await request(buildApp())
        .get('/api/agents/my-assignments')
        .set('Authorization', `Bearer ${agentToken()}`);

      expect(res.status).toBe(200);
      expect(res.body?.success).toBe(true);
    });

    it('returns assignments for an admin JWT', async () => {
      const res = await request(buildApp())
        .get('/api/agents/my-assignments')
        .set('Authorization', `Bearer ${adminToken()}`);

      expect(res.status).toBe(200);
    });

    it('rejects a borrower JWT with 403', async () => {
      const res = await request(buildApp())
        .get('/api/agents/my-assignments')
        .set('Authorization', `Bearer ${borrowerToken()}`);

      expect(res.status).toBe(403);
    });

    it('rejects missing JWT with 401', async () => {
      const res = await request(buildApp()).get('/api/agents/my-assignments');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/agents/:agentPublicKey/assignees', () => {
    const assign = () =>
      request(buildApp())
        .post(`/api/agents/${AGENT}/assignees`)
        .send({ borrowerPublicKey: BORROWER });

    it('allows an admin to assign a borrower', async () => {
      const res = await assign().set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(201);
    });

    it('rejects an agent with 403 — agents cannot mutate assignments', async () => {
      const res = await assign().set('Authorization', `Bearer ${agentToken()}`);
      expect(res.status).toBe(403);
    });

    it('rejects a borrower with 403', async () => {
      const res = await assign().set('Authorization', `Bearer ${borrowerToken()}`);
      expect(res.status).toBe(403);
    });

    it('rejects missing JWT with 401', async () => {
      const res = await assign();
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/agents/:agentPublicKey/assignees/:borrowerPublicKey', () => {
    const revoke = () => request(buildApp()).delete(`/api/agents/${AGENT}/assignees/${BORROWER}`);

    it('allows an admin to revoke an assignment', async () => {
      const res = await revoke().set('Authorization', `Bearer ${adminToken()}`);
      expect(res.status).toBe(200);
    });

    it('rejects an agent with 403', async () => {
      const res = await revoke().set('Authorization', `Bearer ${agentToken()}`);
      expect(res.status).toBe(403);
    });

    it('rejects a borrower with 403', async () => {
      const res = await revoke().set('Authorization', `Bearer ${borrowerToken()}`);
      expect(res.status).toBe(403);
    });
  });

  describe('JWT role claims cannot be forged', () => {
    it('re-caps a forged admin token minted for an agent wallet, so the write stays 403', async () => {
      const { default: jwt } = await import('jsonwebtoken');
      const forged = jwt.sign(
        { publicKey: AGENT, role: 'admin', scopes: ['admin:all'] },
        process.env.JWT_SECRET!,
        { expiresIn: '1h', algorithm: 'HS256' },
      );

      const res = await request(buildApp())
        .post(`/api/agents/${ADMIN}/assignees`)
        .set('Authorization', `Bearer ${forged}`)
        .send({ borrowerPublicKey: BORROWER });

      expect(res.status).toBe(403);
    });
  });
});
