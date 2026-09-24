import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/errorCodes.js';
import { query } from '../db/connection.js';
import { isRoleAtLeast, type UserRole } from '../auth/rbac.js';

/**
 * Role-Based Access Control middleware (Issue #410 / #412).
 *
 * Centralises the role/scope/tenant checks for the DukaPay backend. Roles are
 * resolved from the authenticated JWT (`req.user`) by `requireJwtAuth`, so
 * these checks are declarative gates: they never trust request bodies or
 * params to decide *who* the caller is — only *what* resource id the caller
 * is allowed to reach.
 *
 * Roles (from `auth/rbac.ts`):
 *   - admin    — everything
 *   - agent    — own data + data of assigned borrowers (`agents:view-assigned`)
 *   - borrower — own data only
 *   - auditor  — read-only across audit/compliance surfaces
 *   - lender   — legacy alias of `agent` for pool providers
 */

const ADMIN_ROLE: UserRole = 'admin';
const AGENT_ROLE: UserRole = 'agent';
const AUDITOR_ROLE: UserRole = 'auditor';

export function requireUser(req: Request): NonNullable<Request['user']> {
  if (!req.user?.publicKey) {
    throw AppError.unauthorized('Authentication required');
  }
  return req.user;
}

/**
 * Allows the request through only when the caller's JWT role is one of the
 * given roles. Admins must be listed explicitly when they should pass.
 */
export const requireRole =
  (...roles: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const user = requireUser(req);
    if (!roles.includes(user.role)) {
      throw AppError.forbidden('Insufficient role permissions', ErrorCode.ACCESS_DENIED);
    }
    next();
  };

/** Same as `requireRole` but expressed as a wait-for-either union. */
export const requireAnyRole = requireRole;

/**
 * Allows the request through only when the caller holds all the required
 * scopes (or the `admin:all` wildcard). Scope claims are minted from the
 * wallet's current role at token-issue time and re-capped by `requireJwtAuth`.
 */
export const requireScopes = (...requiredScopes: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = requireUser(req);
    const grantedScopes = new Set(user.scopes ?? []);

    if (grantedScopes.has('admin:all')) {
      return next();
    }

    const missingScope = requiredScopes.find((scope) => !grantedScopes.has(scope));
    if (missingScope) {
      throw AppError.forbidden(`Missing required scope: ${missingScope}`, ErrorCode.ACCESS_DENIED);
    }

    next();
  };
};

/** Alias accepted by callers that want the singular form. */
export const requireScope = requireScopes;

/**
 * Allows the request through only when the role sits at or above `minimum` in
 * the privilege ordering (see `auth/rbac.ts` ROLE_HIERARCHY).
 */
export const requireRoleAtLeast = (minimum: UserRole) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = requireUser(req);
    if (!isRoleAtLeast(user.role, minimum)) {
      throw AppError.forbidden('Insufficient role permissions', ErrorCode.ACCESS_DENIED);
    }
    next();
  };
};

/**
 * True when the caller may operate on `targetWallet`. Pure, synchronous rule
 * evaluation; `assignedBorrowers` may come from the JWT claim minted at login.
 */
export function canAccessWallet(
  user: NonNullable<Request['user']>,
  targetWallet: string | null | undefined,
): boolean {
  if (!targetWallet) return false;

  const role = user.role ?? 'borrower';

  if (role === ADMIN_ROLE || role === AUDITOR_ROLE) {
    return true;
  }

  // Own data is always in scope.
  if (user.publicKey === targetWallet) {
    return true;
  }

  if (role === AGENT_ROLE || role === 'lender') {
    const assigned = user.assignedBorrowers ?? [];
    return assigned.includes(targetWallet);
  }

  return false;
}

/**
 * Injects `assignedBorrowers` onto `req.user` for agents that authenticated
 * before the assignment claim was minted (or when assignments changed after
 * login), using the `agent_assignments` table. Never throws on DB failure —
 * falls back to whatever the JWT already carried.
 */
async function enrichAssignedBorrowers(req: Request): Promise<void> {
  const user = req.user;
  if (!user) return;
  if (user.role !== AGENT_ROLE && user.role !== 'lender') return;
  if ((user.assignedBorrowers?.length ?? 0) > 0) return;

  try {
    const result = await query(
      'SELECT borrower_public_key FROM agent_assignments WHERE agent_public_key = $1',
      [user.publicKey],
    );
    user.assignedBorrowers = (result?.rows ?? []).map(
      (row) => (row as { borrower_public_key: string }).borrower_public_key,
    );
  } catch {
    // Keep the JWT-level claim; assignment freshness is a soft guarantee.
  }
}

/** Resolves the target wallet from common path/body/query shapes. */
export function resolveRequestedWallet(req: Request): string | undefined {
  return (
    req.params?.borrower ??
    req.params?.wallet ??
    req.params?.userId ??
    req.params?.walletAddress ??
    req.params?.address ??
    req.body?.wallet ??
    req.body?.borrowerPublicKey ??
    req.body?.publicKey ??
    req.query?.borrower ??
    req.query?.wallet
  );
}

/**
 * Tenant-isolation gate. Guarantees the caller may only reach resources
 * belonging to:
 *   - themselves (borrower/lender), or
 *   - borrowers explicitly assigned to them (agent), or
 *   - any wallet (admin), or read-only any wallet (auditor).
 *
 * Apply after `requireJwtAuth` on any handler that takes a wallet reference
 * from the request.
 */
export const requireTenantAccess = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const user = requireUser(req);
  const target = resolveRequestedWallet(req);

  if (!target) {
    throw AppError.badRequest('Wallet address is required');
  }

  await enrichAssignedBorrowers(req);

  if (!canAccessWallet(user, target)) {
    throw AppError.forbidden(
      'You are not authorized to access this wallet',
      ErrorCode.ACCESS_DENIED,
    );
  }

  next();
};

/**
 * Combined gate used on write-heavy borrower-scoped routes: the caller must
 * have a write-capable role (borrower/agent/admin/lender — never auditor) AND
 * tenant access to the target wallet.
 */
export const requireWriteTenantAccess = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const user = requireUser(req);

  if (user.role === AUDITOR_ROLE) {
    throw AppError.forbidden('Auditor role is read-only', ErrorCode.ACCESS_DENIED);
  }

  return requireTenantAccess(req, _res, next);
};

/**
 * Audit/compliance gate. Restricts a route to admins (full) and auditors
 * (read-only). Agents, borrowers and lenders are rejected.
 */
export const requireAuditAccess = requireRole(ADMIN_ROLE, AUDITOR_ROLE);
export const requireAdminOrAuditor = requireAuditAccess;

/** Convenience middleware rejections. */
export const requireAdmin = requireRole(ADMIN_ROLE);
export const requireAgent = requireRole(AGENT_ROLE, 'lender', ADMIN_ROLE);
export const requireBorrower = requireRole('borrower', ADMIN_ROLE);

/**
 * Agent assignment gate for routes that reference a single borrower. Admins
 * and auditors pass; borrowers pass only for their own wallet; agents pass
 * only for wallets in their assignment set.
 */
export const requireAssignedBorrowerAccess = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const user = requireUser(req);
  const target = resolveRequestedWallet(req);

  if (!target) {
    throw AppError.badRequest('Borrower wallet address is required');
  }

  if (user.role === ADMIN_ROLE || user.role === AUDITOR_ROLE) {
    return next();
  }

  await enrichAssignedBorrowers(req);

  if (!canAccessWallet(user, target)) {
    throw AppError.forbidden(
      'You are not authorized to access this borrower',
      ErrorCode.ACCESS_DENIED,
    );
  }

  next();
};

export { isRoleAtLeast };
export type { UserRole };
