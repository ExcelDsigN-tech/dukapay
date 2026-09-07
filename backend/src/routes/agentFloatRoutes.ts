import { Router, type Request, type Response } from 'express';
import { agentFloatService } from '../services/agentFloatService.js';
import { requireJwtAuth } from '../middleware/jwtAuth.js';
import { requireRole } from '../middleware/rbac.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

/**
 * POST /float-transfer — Initiate a new agent-to-agent float transfer
 */
router.post(
  '/float-transfer',
  requireJwtAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { fromAgent, toAgent, amount, reason } = req.body;
    const publicKey = (req as { user?: { publicKey?: string } }).user?.publicKey;

    const result = await agentFloatService.initiateTransfer({
      fromAgent,
      toAgent,
      amount: Number(amount),
      reason,
      createdBy: publicKey!,
    });

    res.status(201).json({ success: true, data: result });
  }),
);

/**
 * POST /float-transfer/:id/approve — Approve a pending float transfer
 */
router.post(
  '/float-transfer/:id/approve',
  requireJwtAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const publicKey = (req as { user?: { publicKey?: string } }).user?.publicKey;
    const role = (req as { user?: { role?: string } }).user?.role;

    const result = await agentFloatService.approveTransfer({
      transferId: id,
      approver: publicKey!,
      userRole: role,
    });

    res.status(200).json({ success: true, data: result });
  }),
);

/**
 * POST /float-transfer/:id/reject — Reject a pending float transfer
 */
router.post(
  '/float-transfer/:id/reject',
  requireJwtAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const publicKey = (req as { user?: { publicKey?: string } }).user?.publicKey;
    const role = (req as { user?: { role?: string } }).user?.role;

    const result = await agentFloatService.rejectTransfer({
      transferId: id,
      rejector: publicKey!,
      userRole: role,
    });

    res.status(200).json({ success: true, data: { transfer: result } });
  }),
);

/**
 * GET /float-transfer/limits — Get pair limits for a agent pair
 */
router.get(
  '/float-transfer/limits',
  asyncHandler(async (req: Request, res: Response) => {
    const fromAgent = req.query.fromAgent as string;
    const toAgent = req.query.toAgent as string;

    const result = await agentFloatService.getPairLimits(fromAgent, toAgent);

    res.status(200).json({ success: true, data: result });
  }),
);

/**
 * PUT /float-transfer/limits — Set or update pair limits (Admin only)
 */
router.put(
  '/float-transfer/limits',
  requireJwtAuth,
  requireRole('admin'),
  asyncHandler(async (req: Request, res: Response) => {
    const { fromAgent, toAgent, dailyLimit, weeklyLimit } = req.body;
    const publicKey = (req as { user?: { publicKey?: string } }).user?.publicKey;

    const result = await agentFloatService.setPairLimits({
      fromAgent,
      toAgent,
      dailyLimit: Number(dailyLimit),
      weeklyLimit: Number(weeklyLimit),
      updatedBy: publicKey!,
    });

    res.status(200).json({ success: true, data: result });
  }),
);

export default router;
