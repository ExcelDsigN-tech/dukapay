import type { Request, Response } from 'express';
import { agentFloatService } from '../services/agentFloatService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../errors/AppError.js';

/**
 * POST /api/agents/float-transfer
 * Initiate a new agent-to-agent float transfer request.
 */
export const initiateFloatTransfer = asyncHandler(async (req: Request, res: Response) => {
  const { fromAgent, toAgent, amount, reason } = req.body as {
    fromAgent?: string;
    toAgent?: string;
    amount?: number;
    reason?: string;
  };

  if (!fromAgent || typeof fromAgent !== 'string') {
    throw AppError.badRequest('fromAgent address is required.');
  }
  if (!toAgent || typeof toAgent !== 'string') {
    throw AppError.badRequest('toAgent address is required.');
  }
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    throw AppError.badRequest('amount must be a positive number.');
  }

  const createdBy = req.user?.publicKey ?? req.body.createdBy ?? fromAgent;

  const result = await agentFloatService.initiateTransfer({
    fromAgent,
    toAgent,
    amount,
    ...(reason ? { reason } : {}),
    createdBy,
  });

  res.status(201).json({
    success: true,
    message: 'Float transfer request created successfully.',
    data: result,
  });
});

/**
 * POST /api/agents/float-transfer/:id/approve
 * Approve an existing float transfer request (2-of-3 workflow).
 */
export const approveFloatTransfer = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (!id) {
    throw AppError.badRequest('Transfer ID is required.');
  }

  const approver = req.user?.publicKey ?? (req.body as { approver?: string }).approver;
  if (!approver) {
    throw AppError.unauthorized('Authentication required or approver address must be provided.');
  }

  const userRole = req.user?.role ?? (req.body as { userRole?: string }).userRole;

  const result = await agentFloatService.approveTransfer({
    transferId: id,
    approver,
    ...(userRole ? { userRole } : {}),
  });

  res.status(200).json({
    success: true,
    message: result.transfer.status === 'COMPLETED'
      ? 'Transfer fully approved (2-of-3 threshold met) and executed.'
      : 'Transfer approval recorded successfully.',
    data: result,
  });
});

/**
 * POST /api/agents/float-transfer/:id/reject
 * Reject a float transfer request.
 */
export const rejectFloatTransfer = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (!id) {
    throw AppError.badRequest('Transfer ID is required.');
  }

  const rejector = req.user?.publicKey ?? (req.body as { rejector?: string }).rejector;
  if (!rejector) {
    throw AppError.unauthorized('Authentication required or rejector address must be provided.');
  }

  const userRole = req.user?.role ?? (req.body as { userRole?: string }).userRole;

  const transfer = await agentFloatService.rejectTransfer({
    transferId: id,
    rejector,
    ...(userRole ? { userRole } : {}),
  });

  res.status(200).json({
    success: true,
    message: 'Float transfer request rejected.',
    data: { transfer },
  });
});

/**
 * GET /api/agents/float-transfer/:id
 * Get float transfer details, approvals, and immutable audit trail.
 */
export const getFloatTransfer = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  if (!id) {
    throw AppError.badRequest('Transfer ID is required.');
  }

  const details = await agentFloatService.getTransferDetails(id);

  res.status(200).json({
    success: true,
    data: details,
  });
});

/**
 * GET /api/agents/float-transfer
 * List float transfers with optional filtering by agent or status.
 */
export const listFloatTransfers = asyncHandler(async (req: Request, res: Response) => {
  const agent = req.query.agent as string | undefined;
  const status = req.query.status as string | undefined;
  const limit = req.query.limit ? Number.parseInt(req.query.limit as string, 10) : undefined;
  const offset = req.query.offset ? Number.parseInt(req.query.offset as string, 10) : undefined;

  const result = await agentFloatService.listTransfers({
    ...(agent ? { agent } : {}),
    ...(status ? { status } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  });

  res.status(200).json({
    success: true,
    data: result.transfers,
    pagination: {
      total: result.total,
      limit: limit ?? 20,
      offset: offset ?? 0,
    },
  });
});

/**
 * GET /api/agents/float-transfer/limits
 * Get configurable limits for an agent pair.
 */
export const getPairLimits = asyncHandler(async (req: Request, res: Response) => {
  const fromAgent = req.query.fromAgent as string | undefined;
  const toAgent = req.query.toAgent as string | undefined;

  if (!fromAgent || !toAgent) {
    throw AppError.badRequest('Both fromAgent and toAgent query parameters are required.');
  }

  const limits = await agentFloatService.getPairLimits(fromAgent, toAgent);

  res.status(200).json({
    success: true,
    data: {
      fromAgent,
      toAgent,
      ...limits,
    },
  });
});

/**
 * PUT /api/agents/float-transfer/limits
 * Update pair limits (Admin only).
 */
export const setPairLimits = asyncHandler(async (req: Request, res: Response) => {
  const { fromAgent, toAgent, dailyLimit, weeklyLimit } = req.body as {
    fromAgent?: string;
    toAgent?: string;
    dailyLimit?: number;
    weeklyLimit?: number;
  };

  if (!fromAgent || !toAgent || !dailyLimit || !weeklyLimit) {
    throw AppError.badRequest('fromAgent, toAgent, dailyLimit, and weeklyLimit are required.');
  }

  const updatedBy = req.user?.publicKey ?? 'admin';

  const result = await agentFloatService.setPairLimits({
    fromAgent,
    toAgent,
    dailyLimit,
    weeklyLimit,
    updatedBy,
  });

  res.status(200).json({
    success: true,
    message: 'Pair limits updated successfully.',
    data: result,
  });
});
