import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

const mockQuery =
  jest.fn<() => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
}));

const {
  requireUser,
  requireRole,
  requireAnyRole,
  requireScopes,
  requireScope,
  requireRoleAtLeast,
  canAccessWallet,
  requireTenantAccess,
  requireWriteTenantAccess,
  requireAdminOrAuditor,
  requireAdmin,
  requireAgent,
} = await import('../rbac.js');

const OWNER = 'GOWNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OTHER = 'GOTHERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const AGENT_PK = 'GAGENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

interface UserLike {
  publicKey: string;
  role: string;
  scopes?: string[];
  assignedBorrowers?: string[];
}

function run(
  middleware: (req: Request, res: Response, next: NextFunction) => void | Promise<void>,
  req: Partial<Request>,
): { error: unknown; next: jest.Mock } {
  const next = jest.fn();
  let lastError: unknown = undefined;
  next.mockImplementation((err?: unknown) => {
    lastError = err ?? undefined;
  });
  try {
    const result = middleware(req as Request, {} as Response, next);
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<unknown>).catch((err: unknown) => {
        lastError = err;
      });
    }
  } catch (err) {
    lastError = err;
  }
  return {
    get error() {
      return lastError;
    },
    next,
  };
}

function styleError(err: unknown): { statusCode?: number; message?: string } {
  return err instanceof Error ? (err as { statusCode?: number }) : { message: String(err) };
}

describe('RBAC middleware (#411 / #412)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  const user = (u: UserLike): { user?: unknown } => ({
    user: {
      publicKey: u.publicKey,
      role: u.role,
      scopes: u.scopes ?? [],
      assignedBorrowers: u.assignedBorrowers ?? [],
    },
  });

  describe('requireUser', () => {
    it('rejects unauthenticated requests with 401', () => {
      const next = jest.fn();
      expect(() => requireUser({} as Request)).toThrow(
        expect.objectContaining({ statusCode: 401 }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('returns the caller when authenticated', () => {
      const req = { user: { publicKey: OWNER } };
      expect(requireUser(req as Request)).toEqual(expect.objectContaining({ publicKey: OWNER }));
    });
  });

  describe('requireRole', () => {
    it('passes when the JWT role is listed', () => {
      const req = user({ publicKey: OWNER, role: 'agent' });
      const { error } = run(requireRole('agent', 'admin'), req as Request);
      expect(error).toBeUndefined();
    });

    it('passes for admins only when explicitly listed', () => {
      const req = user({ publicKey: OWNER, role: 'admin' });
      const { error } = run(requireRole('admin'), req as Request);
      expect(error).toBeUndefined();
    });

    it('rejects a borrower on an agent-only route with 403', () => {
      const req = user({ publicKey: OWNER, role: 'borrower' });
      const { error } = run(requireRole('agent', 'admin'), req as Request);
      expect(error).toBeTruthy();
      expect(styleError(error).statusCode).toBe(403);
    });

    it('rejects an admin that is not explicitly listed (no implicit elevation)', () => {
      const req = user({ publicKey: OWNER, role: 'admin' });
      const { error } = run(requireRole('agent'), req as Request);
      expect(error).toBeTruthy();
      expect(styleError(error).statusCode).toBe(403);
    });

    it('rejects unauthenticated requests with 401', () => {
      const { error } = run(requireRole('agent') as never, {});
      expect(error).toBeTruthy();
      expect(styleError(error).statusCode).toBe(401);
    });

    it('requireAnyRole is an alias for requireRole', () => {
      expect(requireAnyRole).toBe(requireRole);
    });
  });

  describe('requireScopes', () => {
    it('passes when the caller holds the required scope', () => {
      const req = user({ publicKey: OWNER, role: 'agent', scopes: ['read:loans'] });
      const { error } = run(requireScopes('read:loans'), req as Request);
      expect(error).toBeUndefined();
    });

    it('passes with the admin:all wildcard regardless of the listed scope', () => {
      const req = user({ publicKey: OWNER, role: 'admin', scopes: ['admin:all'] });
      const { error } = run(requireScopes('anything:any'), req as Request);
      expect(error).toBeUndefined();
    });

    it('rejects with 403 when a required scope is missing', () => {
      const req = user({ publicKey: OWNER, role: 'borrower', scopes: ['read:loans'] });
      const { error } = run(requireScopes('write:repayment'), req as Request);
      expect(error).toBeTruthy();
      expect(styleError(error).statusCode).toBe(403);
    });

    it('requireScope is a singular alias', () => {
      expect(requireScope).toBe(requireScopes);
    });
  });

  describe('requireRoleAtLeast', () => {
    it('passes for a role above the minimum', () => {
      const req = user({ publicKey: OWNER, role: 'admin' });
      const { error } = run(requireRoleAtLeast('borrower'), req as Request);
      expect(error).toBeUndefined();
    });

    it('passes for a role equal to the minimum', () => {
      const req = user({ publicKey: OWNER, role: 'agent' });
      const { error } = run(requireRoleAtLeast('agent'), req as Request);
      expect(error).toBeUndefined();
    });

    it('rejects a role below the minimum with 403', () => {
      const req = user({ publicKey: OWNER, role: 'borrower' });
      const { error } = run(requireRoleAtLeast('agent'), req as Request);
      expect(error).toBeTruthy();
      expect(styleError(error).statusCode).toBe(403);
    });
  });

  describe('canAccessWallet', () => {
    it('grants admins access to any wallet', () => {
      const req = user({ publicKey: OWNER, role: 'admin' });
      expect(canAccessWallet(req.user as never, OTHER)).toBe(true);
    });

    it('grants auditors read access to any wallet', () => {
      const req = user({ publicKey: OWNER, role: 'auditor' });
      expect(canAccessWallet(req.user as never, OTHER)).toBe(true);
    });

    it('grants a borrower access to its own wallet only', () => {
      const req = user({ publicKey: OWNER, role: 'borrower' });
      expect(canAccessWallet(req.user as never, OWNER)).toBe(true);
      expect(canAccessWallet(req.user as never, OTHER)).toBe(false);
    });

    it('grants an agent access only to assigned borrowers', () => {
      const req = user({ publicKey: AGENT_PK, role: 'agent', assignedBorrowers: [OWNER] });
      expect(canAccessWallet(req.user as never, OWNER)).toBe(true);
      expect(canAccessWallet(req.user as never, OTHER)).toBe(false);
    });

    it('rejects null/undefined targets', () => {
      const req = user({ publicKey: OWNER, role: 'admin' });
      expect(canAccessWallet(req.user as never, undefined)).toBe(false);
      expect(canAccessWallet(req.user as never, null)).toBe(false);
    });
  });

  describe('requireTenantAccess', () => {
    it('passes for a borrower accessing its own wallet', async () => {
      const req = user({ publicKey: OWNER, role: 'borrower' });
      req.params = { wallet: OWNER };
      const { error } = await runAsync(requireTenantAccess, req as Request);
      expect(error).toBeUndefined();
    });

    it('rejects a borrower accessing another wallet with 403', async () => {
      const req = user({ publicKey: OWNER, role: 'borrower' });
      req.params = { wallet: OTHER };
      const { error } = await runAsync(requireTenantAccess, req as Request);
      expect(error).toBeTruthy();
      expect(styleError(error).statusCode).toBe(403);
      expect(styleError(error).message).not.toContain(OTHER);
    });

    it('passes for an agent accessing an assigned borrower', async () => {
      mockQuery.mockResolvedValue({ rows: [{ borrower_public_key: OTHER }], rowCount: 1 });
      const req = user({ publicKey: AGENT_PK, role: 'agent' });
      req.params = { borrower: OTHER };
      const { error } = await runAsync(requireTenantAccess, req as Request);
      expect(error).toBeUndefined();
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('agent_assignments'), [
        AGENT_PK,
      ]);
    });

    it('rejects an agent accessing a borrower outside its assignment set with 403', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
      const req = user({ publicKey: AGENT_PK, role: 'agent' });
      req.params = { borrower: OTHER };
      const { error } = await runAsync(requireTenantAccess, req as Request);
      expect(error).toBeTruthy();
      expect(styleError(error).statusCode).toBe(403);
    });

    it('does not hard-fail when the assignment lookup errors — falls back to JWT claims', async () => {
      mockQuery.mockRejectedValue(new Error('db down'));
      const req = user({ publicKey: AGENT_PK, role: 'agent', assignedBorrowers: [OTHER] });
      req.params = { borrower: OTHER };
      const { error } = await runAsync(requireTenantAccess, req as Request);
      expect(error).toBeUndefined();
    });

    it('passes for an admin on any wallet', async () => {
      const req = user({ publicKey: OWNER, role: 'admin' });
      req.params = { wallet: OTHER };
      const { error } = await runAsync(requireTenantAccess, req as Request);
      expect(error).toBeUndefined();
    });

    it('passes for an auditor on any wallet', async () => {
      const req = user({ publicKey: OWNER, role: 'auditor' });
      req.params = { wallet: OTHER };
      const { error } = await runAsync(requireTenantAccess, req as Request);
      expect(error).toBeUndefined();
    });

    it('rejects with 400 when no wallet can be resolved', async () => {
      const req = user({ publicKey: OWNER, role: 'admin' });
      req.params = {};
      const { error } = await runAsync(requireTenantAccess, req as Request);
      expect(error).toBeTruthy();
      expect(styleError(error).statusCode).toBe(400);
    });

    it('rejects unauthenticated requests with 401', async () => {
      const req = { params: { wallet: OWNER } };
      const { error } = await runAsync(requireTenantAccess, req as Request);
      expect(error).toBeTruthy();
      expect(styleError(error).statusCode).toBe(401);
    });

    it('resolves the target from alternate path/body/query shapes', async () => {
      const shapes: Array<[Partial<Request>]> = [
        [{ params: { userId: OWNER } }],
        [{ params: { walletAddress: OWNER } }],
        [{ params: { address: OWNER } }],
        [{ body: { wallet: OWNER } }],
        [{ body: { borrowerPublicKey: OWNER } }],
        [{ query: { wallet: OWNER } }],
      ];
      for (const [req] of shapes) {
        const full = { ...user({ publicKey: OWNER, role: 'borrower' }), ...req };
        const { error } = await runAsync(requireTenantAccess, full as Request);
        expect(error).toBeUndefined();
      }
    });
  });

  describe('requireWriteTenantAccess', () => {
    it('blocks auditors with 403 regardless of target', async () => {
      const req = user({ publicKey: OWNER, role: 'auditor' });
      req.params = { wallet: OTHER };
      const { error } = await runAsync(requireWriteTenantAccess, req as Request);
      expect(error).toBeTruthy();
      expect(styleError(error).statusCode).toBe(403);
    });

    it('passes for a borrower on its own wallet', async () => {
      const req = user({ publicKey: OWNER, role: 'borrower' });
      req.params = { wallet: OWNER };
      const { error } = await runAsync(requireWriteTenantAccess, req as Request);
      expect(error).toBeUndefined();
    });
  });

  describe('convenience gates', () => {
    it('requireAdminOrAuditor passes for both roles', () => {
      const admin = run(
        requireAdminOrAuditor,
        user({ publicKey: OWNER, role: 'admin' }) as Request,
      );
      const auditor = run(
        requireAdminOrAuditor,
        user({ publicKey: OWNER, role: 'auditor' }) as Request,
      );
      const borrower = run(
        requireAdminOrAuditor,
        user({ publicKey: OWNER, role: 'borrower' }) as Request,
      );
      expect(admin.error).toBeUndefined();
      expect(auditor.error).toBeUndefined();
      expect(styleError(borrower.error).statusCode).toBe(403);
    });

    it('requireAdmin is admin-only', () => {
      const admin = run(requireAdmin, user({ publicKey: OWNER, role: 'admin' }) as Request);
      const agent = run(requireAdmin, user({ publicKey: OWNER, role: 'agent' }) as Request);
      expect(admin.error).toBeUndefined();
      expect(styleError(agent.error).statusCode).toBe(403);
    });

    it('requireAgent admits agents, lenders and admins', () => {
      const agent = run(requireAgent, user({ publicKey: OWNER, role: 'agent' }) as Request);
      const admin = run(requireAgent, user({ publicKey: OWNER, role: 'admin' }) as Request);
      const borrower = run(requireAgent, user({ publicKey: OWNER, role: 'borrower' }) as Request);
      expect(agent.error).toBeUndefined();
      expect(admin.error).toBeUndefined();
      expect(styleError(borrower.error).statusCode).toBe(403);
    });
  });
});

async function runAsync(
  middleware: (req: Request, res: Response, next: NextFunction) => Promise<void>,
  req: Request,
): Promise<{ error: unknown }> {
  let lastError: unknown = undefined;
  const next = jest.fn((err?: unknown) => {
    lastError = err ?? undefined;
  });
  try {
    await middleware(req, {} as Response, next);
  } catch (err) {
    lastError = err;
  }
  return {
    get error() {
      return lastError;
    },
  };
}
