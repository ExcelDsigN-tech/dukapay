import type { Request, Response } from 'express';
import { AppError } from '../errors/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  assignBorrowerToAgent,
  removeBorrowerFromAgent,
  listAgentAssignments,
} from '../services/tenantService.js';
import { StrKey } from '@stellar/stellar-sdk';

const requirePublicKey = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw AppError.badRequest(`${field} is required`, undefined, field);
  }
  if (!StrKey.isValidEd25519PublicKey(value)) {
    throw AppError.badRequest(`Invalid Stellar public key for ${field}`, undefined, field);
  }
  return value;
};

/**
 * GET /api/agents/my-assignments
 * Lists the borrower wallets currently assigned to the authenticated agent.
 */
export const getMyAssignments = asyncHandler(async (req: Request, res: Response) => {
  const agent = req.user?.publicKey;
  if (!agent) throw AppError.unauthorized('Authentication required');

  const assignments = await listAgentAssignments(agent);

  res.json({
    success: true,
    data: {
      agentPublicKey: agent,
      assignments: assignments.map((a) => ({
        borrowerPublicKey: a.borrower_public_key,
        createdAt: a.created_at,
      })),
    },
  });
});

/**
 * POST /api/agents/:agentPublicKey/assignees
 * Admins assign borrower wallets to an agent, granting the agent read access
 * to those borrowers' data (tenant scope).
 */
export const assignBorrower = asyncHandler(async (req: Request, res: Response) => {
  const admin = req.user?.publicKey;
  const agentPublicKey = requirePublicKey(req.params.agentPublicKey, 'agentPublicKey');
  const borrowerPublicKey = requirePublicKey(req.body.borrowerPublicKey, 'borrowerPublicKey');

  if (admin === borrowerPublicKey || admin === agentPublicKey) {
    // Self-assignments are meaningless; block to keep the audit trail clean.
    throw AppError.badRequest('Cannot assign a wallet to itself');
  }

  const assignment = await assignBorrowerToAgent(agentPublicKey, borrowerPublicKey, admin);

  res.status(201).json({
    success: true,
    data: {
      agentPublicKey: assignment.agent_public_key,
      borrowerPublicKey: assignment.borrower_public_key,
      createdAt: assignment.created_at,
    },
  });
});

/**
 * DELETE /api/agents/:agentPublicKey/assignees/:borrowerPublicKey
 * Admins revoke an agent's access to a borrower.
 */
export const removeBorrower = asyncHandler(async (req: Request, res: Response) => {
  const agentPublicKey = requirePublicKey(req.params.agentPublicKey, 'agentPublicKey');
  const borrowerPublicKey = requirePublicKey(req.params.borrowerPublicKey, 'borrowerPublicKey');

  const removed = await removeBorrowerFromAgent(agentPublicKey, borrowerPublicKey);
  if (!removed) {
    throw AppError.notFound('Agent assignment not found');
  }

  res.json({ success: true, data: { removed: true } });
});
