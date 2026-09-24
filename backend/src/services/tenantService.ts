import { query } from '../db/connection.js';
import type { UserRole } from '../auth/rbac.js';

/**
 * Tenant-assignment management (Issue #410 / #412).
 *
 * `agent_assignments` is the join table that defines which borrowers an agent
 * may act on. It backs:
 *   - the `agents:view-assigned` scope enforced by `middleware/rbac.ts`, and
 *   - the RLS policy `*_rls_agent_assigned` installed on the data tables.
 *
 * Writng happens here (service/config surface), so the table itself remains
 * strictly append-only for application roles.
 */

export interface AgentAssignment {
  agent_public_key: string;
  borrower_public_key: string;
  created_at: Date | string;
  created_by: string | null;
}

/**
 * Borrower wallets currently assigned to `publicKey`, or `[]` for any role
 * that is not an agent/lender. DB failures degrade to `[]` so authentication
 * and authorization never hard-fail on a transient read.
 */
export async function resolveAssignedBorrowers(
  publicKey: string,
  role?: UserRole,
): Promise<string[]> {
  if (role !== 'agent' && role !== 'lender') {
    return [];
  }

  try {
    const result = await query(
      'SELECT borrower_public_key FROM agent_assignments WHERE agent_public_key = $1',
      [publicKey],
    );
    return (result?.rows ?? []).map(
      (row) => (row as { borrower_public_key: string }).borrower_public_key,
    );
  } catch {
    return [];
  }
}

/** Assigns a borrower to an agent (idempotent via unique constraint). */
export async function assignBorrowerToAgent(
  agentPublicKey: string,
  borrowerPublicKey: string,
  createdBy?: string,
): Promise<AgentAssignment> {
  const result = await query(
    `INSERT INTO agent_assignments (agent_public_key, borrower_public_key, created_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (agent_public_key, borrower_public_key) DO NOTHING
     RETURNING agent_public_key, borrower_public_key, created_at, created_by`,
    [agentPublicKey, borrowerPublicKey, createdBy ?? null],
  );

  const row = result.rows[0];
  if (!row) {
    // Existing assignment — return the stored row so callers can treat the
    // operation as idempotent.
    const existing = await query(
      `SELECT agent_public_key, borrower_public_key, created_at, created_by
       FROM agent_assignments
       WHERE agent_public_key = $1 AND borrower_public_key = $2`,
      [agentPublicKey, borrowerPublicKey],
    );
    const existingRow = existing.rows[0];
    if (existingRow) {
      return existingRow as AgentAssignment;
    }
    throw new Error('Failed to create agent assignment');
  }

  return row as AgentAssignment;
}

/** Removes a borrower from an agent's scope. Returns true when a row was deleted. */
export async function removeBorrowerFromAgent(
  agentPublicKey: string,
  borrowerPublicKey: string,
): Promise<boolean> {
  const result = await query(
    'DELETE FROM agent_assignments WHERE agent_public_key = $1 AND borrower_public_key = $2',
    [agentPublicKey, borrowerPublicKey],
  );
  return (result?.rowCount ?? 0) > 0;
}

/** Lists every assignment for an agent. */
export async function listAgentAssignments(agentPublicKey: string): Promise<AgentAssignment[]> {
  const result = await query(
    `SELECT agent_public_key, borrower_public_key, created_at, created_by
     FROM agent_assignments
     WHERE agent_public_key = $1
     ORDER BY created_at DESC`,
    [agentPublicKey],
  );
  return (result?.rows ?? []) as AgentAssignment[];
}

/** Lists all borrower wallets assigned to an agent. */
export async function listAssignedBorrowersForAgent(agentPublicKey: string): Promise<string[]> {
  const result = await query(
    'SELECT borrower_public_key FROM agent_assignments WHERE agent_public_key = $1',
    [agentPublicKey],
  );
  return (result?.rows ?? []).map(
    (row) => (row as { borrower_public_key: string }).borrower_public_key,
  );
}
