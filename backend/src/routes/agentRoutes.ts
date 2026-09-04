import { Router } from 'express';
import {
  assignBorrower,
  getMyAssignments,
  removeBorrower,
} from '../controllers/agentController.js';
import { requireJwtAuth } from '../middleware/jwtAuth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditLog } from '../middleware/auditLog.js';

const router = Router();

/**
 * @swagger
 * /agents/my-assignments:
 *   get:
 *     summary: List borrower wallets assigned to the authenticated agent
 *     description: >
 *       Returns the borrowers the authenticated agent (or admin) is scoped to
 *       under tenant isolation (the `agents:view-assigned` scope). Agents can
 *       read but not modify the data of these borrowers on the loan, score and
 *       remittance endpoints, enforced both by the RBAC middleware and by RLS.
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Assignments retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, data]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   required: [agentPublicKey, assignments]
 *                   properties:
 *                     agentPublicKey:
 *                       type: string
 *                     assignments:
 *                       type: array
 *                       items:
 *                         type: object
 *                         required: [borrowerPublicKey, createdAt]
 *                         properties:
 *                           borrowerPublicKey:
 *                             type: string
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: Requires the agent role.
 */
router.get(
  '/my-assignments',
  requireJwtAuth,
  requireRole('agent', 'lender', 'admin'),
  getMyAssignments,
);

/**
 * @swagger
 * /agents/{agentPublicKey}/assignees:
 *   post:
 *     summary: Assign a borrower to an agent (admin only)
 *     description: >
 *       Grants an agent read access to a borrower's data. Idempotent: assigning
 *       the same pair twice returns the existing assignment. Admin only.
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentPublicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent's Stellar public key receiving the assignment
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [borrowerPublicKey]
 *             properties:
 *               borrowerPublicKey:
 *                 type: string
 *                 description: Borrower's Stellar public key to assign
 *     responses:
 *       201:
 *         description: Assignment created (or already present).
 *       400:
 *         description: Invalid public key.
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: Requires the admin role.
 */
router.post(
  '/:agentPublicKey/assignees',
  requireJwtAuth,
  requireRole('admin'),
  auditLog,
  assignBorrower,
);

/**
 * @swagger
 * /agents/{agentPublicKey}/assignees/{borrowerPublicKey}:
 *   delete:
 *     summary: Revoke a borrower assignment from an agent (admin only)
 *     description: >
 *       Removes the agent's read access to the borrower. Admin only.
 *     tags: [Agents]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentPublicKey
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: borrowerPublicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Assignment revoked.
 *       400:
 *         description: Invalid public key.
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: Requires the admin role.
 *       404:
 *         description: Assignment not found.
 */
router.delete(
  '/:agentPublicKey/assignees/:borrowerPublicKey',
  requireJwtAuth,
  requireRole('admin'),
  auditLog,
  removeBorrower,
);

export default router;
