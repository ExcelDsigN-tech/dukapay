import { Router } from 'express';
import {
  initiateFloatTransfer,
  approveFloatTransfer,
  rejectFloatTransfer,
  getFloatTransfer,
  listFloatTransfers,
  getPairLimits,
  setPairLimits,
} from '../controllers/agentController.js';
import { optionalJwtAuth } from '../middleware/jwtAuth.js';
import { auditLog } from '../middleware/auditLog.js';
import { idempotencyMiddleware } from '../middleware/idempotency.js';

const router = Router();

// Apply optional JWT authentication to attach req.user if token is present
router.use(optionalJwtAuth);

/**
 * @swagger
 * /api/agents/float-transfer:
 *   post:
 *     summary: Initiate an agent-to-agent float transfer request
 *     description: Enable agents to transfer float directly to other agents without borrower involvement. Subject to configurable daily/weekly pair limits.
 *     tags: [Agents]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fromAgent, toAgent, amount]
 *             properties:
 *               fromAgent:
 *                 type: string
 *                 description: Source agent wallet address
 *               toAgent:
 *                 type: string
 *                 description: Recipient agent wallet address
 *               amount:
 *                 type: number
 *                 description: Float amount to transfer
 *               reason:
 *                 type: string
 *                 description: Reason for float transfer (e.g., covering shortfalls, regional balancing)
 *     responses:
 *       201:
 *         description: Float transfer request created with initial approval
 *       400:
 *         description: Validation error or pair limit exceeded
 *   get:
 *     summary: List agent float transfers
 *     tags: [Agents]
 *     parameters:
 *       - in: query
 *         name: agent
 *         schema:
 *           type: string
 *         description: Filter by agent address (source or recipient)
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by transfer status (PENDING_APPROVAL, COMPLETED, REJECTED)
 *     responses:
 *       200:
 *         description: List of float transfers
 */
router.post('/float-transfer', auditLog, idempotencyMiddleware, initiateFloatTransfer);
router.get('/float-transfer', listFloatTransfers);

/**
 * @swagger
 * /api/agents/float-transfer/limits:
 *   get:
 *     summary: Get daily and weekly float transfer limits for an agent pair
 *     tags: [Agents]
 *     parameters:
 *       - in: query
 *         name: fromAgent
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: toAgent
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transfer limits for the agent pair
 *   put:
 *     summary: Update daily and weekly float transfer limits for an agent pair (Admin)
 *     tags: [Agents]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fromAgent, toAgent, dailyLimit, weeklyLimit]
 *             properties:
 *               fromAgent:
 *                 type: string
 *               toAgent:
 *                 type: string
 *               dailyLimit:
 *                 type: number
 *               weeklyLimit:
 *                 type: number
 *     responses:
 *       200:
 *         description: Pair limits updated
 */
router.get('/float-transfer/limits', getPairLimits);
router.put('/float-transfer/limits', auditLog, setPairLimits);

/**
 * @swagger
 * /api/agents/float-transfer/{id}:
 *   get:
 *     summary: Get float transfer request details, approvals, and audit trail
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Detailed float transfer information
 *       404:
 *         description: Transfer request not found
 */
router.get('/float-transfer/:id', getFloatTransfer);

/**
 * @swagger
 * /api/agents/float-transfer/{id}/approve:
 *   post:
 *     summary: Approve an agent float transfer (2-of-3 multisig workflow)
 *     description: Approves a pending float transfer. When 2 of 3 approvals (initiator, recipient, admin) are reached, the transfer completes and executes on-chain.
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Approval recorded; status updated to COMPLETED if threshold reached
 *       400:
 *         description: Validation error or already approved
 *       403:
 *         description: Forbidden - approver is not a valid party
 */
router.post('/float-transfer/:id/approve', auditLog, idempotencyMiddleware, approveFloatTransfer);

/**
 * @swagger
 * /api/agents/float-transfer/{id}/reject:
 *   post:
 *     summary: Reject an agent float transfer
 *     tags: [Agents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Float transfer request rejected
 *       403:
 *         description: Forbidden - rejector is not authorized
 */
router.post('/float-transfer/:id/reject', auditLog, idempotencyMiddleware, rejectFloatTransfer);

export default router;
