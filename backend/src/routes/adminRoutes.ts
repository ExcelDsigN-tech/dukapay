import { Router } from 'express';
import { z } from 'zod';
import { requireApiKey } from '../middleware/auth.js';
import { requireJwtAuth, requireRoles } from '../middleware/jwtAuth.js';
import { strictRateLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validation.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { auditLog } from '../middleware/auditLog.js';
import { idempotencyMiddleware } from '../middleware/idempotency.js';
import { defaultChecker } from '../services/defaultChecker.js';
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  getWebhookDeliveries,
  listQuarantinedEvents,
  listWebhookSubscriptions,
  reprocessQuarantinedEvents,
  reindexLedgerRange,
} from '../controllers/indexerController.js';
import {
  listLoanDisputes,
  resolveLoanDispute,
  getLoanDispute,
  rejectLoanDispute,
} from '../controllers/adminDisputeController.js';
import { getPendingGovernance } from '../controllers/adminGovernanceController.js';
import { query } from '../db/connection.js';

import { buildRejectLoanTx } from '../controllers/loanController.js';
import { listAuditLogs } from '../controllers/authController.js';

const router = Router();

router.get('/audit-logs', requireJwtAuth, requireRoles('admin'), listAuditLogs);

router.post(
  '/loans/:loanId/build-reject',
  requireJwtAuth,
  requireRoles('admin'),
  auditLog,
  idempotencyMiddleware,
  buildRejectLoanTx,
);
/**
 * @swagger
 * /admin/loan-disputes:
 *   get:
 *     summary: List open loan disputes
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of open disputes
 *
 * /admin/loan-disputes/{disputeId}/resolve:
 *   post:
 *     summary: Resolve a loan dispute (confirm or reverse default)
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: disputeId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - action
 *               - resolution
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [confirm, reverse]
 *                 description: Action to take on the dispute
 *               resolution:
 *                 type: string
 *                 description: Detailed reason for resolution (minimum 5 characters)
 *               adminNote:
 *                 type: string
 *                 description: Optional admin note visible to borrower
 *     responses:
 *       200:
 *         description: Dispute resolved and borrower notified
 *       400:
 *         description: Validation error
 */
router.get('/loan-disputes', requireApiKey('admin:disputes'), listLoanDisputes);
router.post(
  '/loan-disputes/:disputeId/resolve',
  requireApiKey('admin:disputes'),
  auditLog,
  idempotencyMiddleware,
  resolveLoanDispute,
);
// New admin JWT-protected endpoints

/**
 * @swagger
 * /admin/disputes:
 *   get:
 *     summary: List loan disputes
 *     description: >
 *       Returns a keyset-paginated list of loan disputes, optionally filtered
 *       by status (`open`, `resolved`, `rejected`, or `all`). Admin only.
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, resolved, rejected, all]
 *         description: Filter by dispute status (default `open`)
 *       - in: query
 *         name: snapshot_seq
 *         schema:
 *           type: string
 *         description: Snapshot sequence for stable pagination
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Opaque keyset cursor from a previous response
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Disputes retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, data, page]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   required: [items]
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/LoanDispute'
 *                 page:
 *                   type: object
 *                   required: [next_cursor, snapshot_seq, total_at_snapshot, limit]
 *                   properties:
 *                     next_cursor:
 *                       type: string
 *                       nullable: true
 *                     snapshot_seq:
 *                       type: string
 *                     total_at_snapshot:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *       400:
 *         description: Invalid query parameters.
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: Requires the admin role.
 */
router.get('/disputes', requireJwtAuth, requireRoles('admin'), listLoanDisputes);

/**
 * @swagger
 * /admin/disputes/{disputeId}:
 *   get:
 *     summary: Get a single loan dispute
 *     description: >
 *       Returns a dispute together with its joined loan record. Admin only.
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: disputeId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Dispute ID
 *     responses:
 *       200:
 *         description: Dispute retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, dispute]
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 dispute:
 *                   allOf:
 *                     - $ref: '#/components/schemas/LoanDispute'
 *                     - type: object
 *                       required: [loan]
 *                       properties:
 *                         loan:
 *                           type: object
 *                           description: Joined loan record
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: Requires the admin role.
 *       404:
 *         description: Dispute not found.
 */
router.get('/disputes/:disputeId', requireJwtAuth, requireRoles('admin'), getLoanDispute);
/**
 * @swagger
 * /admin/disputes/{disputeId}/resolve:
 *   post:
 *     summary: Resolve a loan dispute
 *     description: >
 *       Resolves an open dispute. `action` of `confirm` keeps the loan as
 *       defaulted (writes a `DefaultConfirmed` event) while `reverse` marks
 *       the loan active again (writes a `DefaultReversed` event). Admin only.
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: disputeId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Dispute ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action, resolution]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [confirm, reverse]
 *               resolution:
 *                 type: string
 *                 minLength: 5
 *               adminNote:
 *                 type: string
 *     responses:
 *       200:
 *         description: Dispute resolved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessMessageResponse'
 *       400:
 *         description: Invalid action or resolution.
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: Requires the admin role.
 *       404:
 *         description: Dispute not found or not open.
 */
router.post(
  '/disputes/:disputeId/resolve',
  requireJwtAuth,
  requireRoles('admin'),
  auditLog,
  idempotencyMiddleware,
  resolveLoanDispute,
);
/**
 * @swagger
 * /admin/disputes/{disputeId}/reject:
 *   post:
 *     summary: Reject a loan dispute
 *     description: >
 *       Rejects an open dispute, marking it `rejected` with an optional admin
 *       note. Admin only.
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: disputeId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Dispute ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               admin_note:
 *                 type: string
 *                 description: Optional note written as the resolution reason
 *     responses:
 *       200:
 *         description: Dispute rejected successfully.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessMessageResponse'
 *       400:
 *         description: Invalid request.
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: Requires the admin role.
 *       404:
 *         description: Dispute not found or not open.
 */
router.post(
  '/disputes/:disputeId/reject',
  requireJwtAuth,
  requireRoles('admin'),
  auditLog,
  idempotencyMiddleware,
  rejectLoanDispute,
);

/**
 * @swagger
 * /admin/governance/pending:
 *   get:
 *     summary: Get the pending governance proposal
 *     description: >
 *       Returns the currently pending multisig governance proposal (proposed
 *       admin, signer approvals, timelock) as well as the current admin and
 *       target contract. Admin only.
 *     tags: [Admin]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Pending governance proposal retrieved.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 currentAdmin:
 *                   type: string
 *                   nullable: true
 *                 targetContract:
 *                   type: string
 *                   nullable: true
 *                 pendingProposal:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     id:
 *                       type: string
 *                       nullable: true
 *                     proposedAdmin:
 *                       type: string
 *                       nullable: true
 *                     approvalCount:
 *                       type: integer
 *                     threshold:
 *                       type: integer
 *                     executableAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     expiresAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                     signers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           address:
 *                             type: string
 *                           approved:
 *                             type: boolean
 *                 signers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       address:
 *                         type: string
 *                       approved:
 *                         type: boolean
 *                 threshold:
 *                   type: integer
 *       401:
 *         description: Missing or invalid Bearer token.
 *       403:
 *         description: Requires the admin role.
 */
router.get('/governance/pending', requireJwtAuth, requireRoles('admin'), getPendingGovernance);

const checkDefaultsBodySchema = z.object({
  loanIds: z
    .array(z.number().int().positive())
    .max(1000, 'max 1000 loan IDs per request')
    .optional(),
});

/**
 * @swagger
 * /admin/check-defaults:
 *   post:
 *     summary: Trigger manual on-chain default checks for a set of loans
 *     description: >
 *       Calls the LoanManager `check_defaults` contract function for the
 *       provided loan IDs (or all overdue loans if IDs are omitted).
 *       Bounded to a maximum of 1000 IDs per request for security.
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               loanIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 maxItems: 1000
 *                 description: Explicit list of loan IDs to check
 *     responses:
 *       200:
 *         description: Default check run completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DefaultCheckRunResult'
 *       400:
 *         description: Validation error or too many IDs
 */
router.post(
  '/check-defaults',
  requireApiKey('admin:loans'),
  strictRateLimiter,
  auditLog,
  idempotencyMiddleware,
  validateBody(checkDefaultsBodySchema),
  asyncHandler(async (req, res) => {
    const result = await defaultChecker.checkOverdueLoans(req.body.loanIds);
    res.json(result);
  }),
);

/**
 * @swagger
 * /admin/reindex:
 *   post:
 *     summary: Backfill/reindex contract events for a ledger range
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: fromLedger
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: toLedger
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Reindex completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReindexResponse'
 */
router.post(
  '/reindex',
  requireApiKey('admin:indexer'),
  strictRateLimiter,
  auditLog,
  reindexLedgerRange,
);

/**
 * @swagger
 * /admin/quarantine-events:
 *   get:
 *     summary: List quarantined indexer events
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: cursor
 *         required: false
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Quarantined events retrieved
 */
router.get('/quarantine-events', requireApiKey('admin:indexer'), listQuarantinedEvents);

/**
 * @swagger
 * /admin/quarantine-events/reprocess:
 *   post:
 *     summary: Reprocess quarantined indexer events
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *               limit:
 *                 type: integer
 *                 default: 50
 *     responses:
 *       200:
 *         description: Reprocess attempt completed
 */
router.post(
  '/quarantine-events/reprocess',
  requireApiKey('admin:indexer'),
  strictRateLimiter,
  auditLog,
  reprocessQuarantinedEvents,
);

/**
 * @swagger
 * /admin/webhooks:
 *   post:
 *     summary: Register a webhook subscription
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [callbackUrl, eventTypes]
 *             properties:
 *               callbackUrl:
 *                 type: string
 *               eventTypes:
 *                 type: array
 *                 items:
 *                   type: string
 *               secret:
 *                 type: string
 *     responses:
 *       201:
 *         description: Subscription created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookSubscriptionResponse'
 */
router.post(
  '/webhooks',
  requireApiKey('admin:webhooks'),
  strictRateLimiter,
  auditLog,
  createWebhookSubscription,
);

/**
 * @swagger
 * /admin/webhooks:
 *   get:
 *     summary: List webhook subscriptions
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of subscriptions
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookSubscriptionListResponse'
 */
router.get('/webhooks', requireApiKey('admin:webhooks'), listWebhookSubscriptions);

/**
 * @swagger
 * /admin/webhooks/{id}:
 *   delete:
 *     summary: Remove a webhook subscription
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Subscription deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessMessageResponse'
 */
router.delete(
  '/webhooks/:id',
  requireApiKey('admin:webhooks'),
  strictRateLimiter,
  auditLog,
  deleteWebhookSubscription,
);

/**
 * @swagger
 * /admin/webhooks/{id}/deliveries:
 *   get:
 *     summary: View webhook delivery history
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Delivery history returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookDeliveriesResponse'
 */
router.get('/webhooks/:id/deliveries', requireApiKey('admin:webhooks'), getWebhookDeliveries);

/**
 * @swagger
 * /admin/webhooks/retry-status:
 *   get:
 *     summary: Get status of failed webhooks and retry queue
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Retry status information
 */
router.get(
  '/webhooks/retry-status',
  requireApiKey('admin:webhooks'),
  asyncHandler(async (_req, res) => {
    const result = await query(`
      SELECT 
        COUNT(*) as total_failed,
        COUNT(*) FILTER (WHERE attempt_count >= 5) as permanently_failed,
        COUNT(*) FILTER (WHERE next_retry_at IS NOT NULL) as pending_retry
      FROM webhook_deliveries
      WHERE delivered_at IS NULL
    `);

    res.json(result.rows[0]);
  }),
);

export default router;
