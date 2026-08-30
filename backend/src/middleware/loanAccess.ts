import { query } from '../db/connection.js';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/errorCodes.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/**
 * After `requireJwtAuth`, ensures `req.params.loanId` refers to a loan the
 * caller is entitled to read under RBAC/tenant isolation:
 *   - admin/auditor  → any loan (read-only surfaces)
 *   - agent/lender   → loans of borrowers explicitly assigned to the agent
 *   - borrower       → loans where the JWT `publicKey` is the borrower
 * Returns 404 when the loan is missing and 403 when the caller has no
 * entitlement to it.
 */
export const requireLoanBorrowerAccess = asyncHandler(async (req, _res, next) => {
  const loanId = req.params.loanId;
  const pk = req.user?.publicKey;
  const role = req.user?.role;

  if (!pk) {
    throw AppError.unauthorized('Authentication required');
  }
  if (!loanId) {
    throw AppError.badRequest('Loan ID is required');
  }

  // Admins, auditors and lenders are allowed to view loan details.
  if (role === 'admin' || role === 'auditor' || role === 'lender') {
    return next();
  }

  const r = await query(`SELECT address FROM contract_events WHERE loan_id = $1 LIMIT 1`, [loanId]);

  const row = r?.rows?.[0] as { address: string } | undefined;
  if (!row) {
    throw AppError.notFound('Loan not found');
  }
  if (row.address === pk) {
    return next();
  }

  // Agents: allow loans of borrowers in their assignment set.
  if (role === 'agent') {
    const assigned = (req.user?.assignedBorrowers ?? []).filter(Boolean);
    if (assigned.length > 0) {
      if (assigned.includes(row.address)) {
        return next();
      }
    } else {
      const ar = await query(
        `SELECT 1 FROM agent_assignments
         WHERE agent_public_key = $1 AND borrower_public_key = $2 LIMIT 1`,
        [pk, row.address],
      );
      if (ar?.rows?.length) {
        return next();
      }
    }
  }

  throw AppError.forbidden('You are not authorized to access this loan', ErrorCode.ACCESS_DENIED);
});

/**
 * After `requireJwtAuth`, ensures the authenticated user owns the loan specified in params.
 * Supports both `loanId` and `id` as parameter names.
 * Returns 404 when the loan is missing and 403 when it belongs to a different borrower.
 *
 * Ownership check (#1365): compare the loan's stored owner (`row.address`) to the
 * caller's JWT public key (`pk`). Never compare the caller key to itself.
 */
export const requireLoanOwner = asyncHandler(async (req, _res, next) => {
  const loanId = req.params.loanId || req.params.id;
  const pk = req.user?.publicKey;

  if (!pk) {
    throw AppError.unauthorized('Authentication required');
  }
  if (!loanId) {
    throw AppError.badRequest('Loan ID is required');
  }

  // Fetch loan borrower/owner from the unified view
  const r = await query(`SELECT address FROM loan_events WHERE loan_id = $1 LIMIT 1`, [loanId]);

  const row = r?.rows?.[0] as { address: string } | undefined;
  if (!row) {
    throw AppError.notFound('Loan not found');
  }

  const loanOwner = row.address;
  if (loanOwner !== pk) {
    throw AppError.forbidden('You are not authorized to access this loan', ErrorCode.ACCESS_DENIED);
  }

  next();
});
