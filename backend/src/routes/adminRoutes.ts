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
import {
  listUsers,
  getUser,
  updateUserStatus,
  updateUserRole,
  overrideKycStatus,
  getSystemHealth,
  triggerBatchSettlement,
  listFeatureFlags,
  updateFeatureFlag,
} from '../controllers/adminOpsController.js';
import { query } from '../db/connection.js';
import { cacheService } from '../services/cacheService.js';
import type { UserRole } from '../auth/rbac.js';

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
router.get('/disputes', requireJwtAuth, requireRoles('admin'), listLoanDisputes);
router.get('/disputes/:disputeId', requireJwtAuth, requireRoles('admin'), getLoanDispute);
router.post(
  '/disputes/:disputeId/resolve',
  requireJwtAuth,
  requireRoles('admin'),
  auditLog,
  idempotencyMiddleware,
  resolveLoanDispute,
);
router.post(
  '/disputes/:disputeId/reject',
  requireJwtAuth,
  requireRoles('admin'),
  auditLog,
  idempotencyMiddleware,
  rejectLoanDispute,
);

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

/*
 * Admin Operations Center (issue #427)
 *
 * Fine-grained RBAC: in addition to the legacy `admin` role, the platform
 * now recognises `super_admin`, `ops`, and `support` levels.  All of them
 * pass the JWT authentication gate; individual sub-sections below are
 * further restricted by role scope to enforce least-privilege.
 */

const ALL_ADMINS: UserRole[] = ['admin', 'super_admin', 'ops', 'support'];
const PRIVILEGED_ADMINS: UserRole[] = ['admin', 'super_admin'];
const KYC_ADMINS: UserRole[] = ['admin', 'super_admin', 'support'];

/**
 * Response caching middleware. Caches JSON responses in Redis with the
 * given TTL. Cache key includes query params so filtered views are
 * cached separately.
 */
function cacheServiceMiddleware(cacheKeyPrefix: string, ttlSeconds: number) {
  return async (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    const cacheKey = `${cacheKeyPrefix}:${JSON.stringify(req.query)}`;
    try {
      const cached = await cacheService.get<string>(cacheKey);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        res.json(JSON.parse(cached));
        return;
      }
    } catch {
      // Cache miss or error — proceed normally
    }

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      void cacheService.set(cacheKey, body, ttlSeconds).catch(() => {});
      return originalJson(body);
    }) as typeof res.json;

    next();
  };
}

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: List users (paginated, filterable)
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, max: 200 }
 *       - in: query
 *         name: offset
 *         schema: { type: integer, default: 0 }
 *       - in: query
 *         name: role
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, suspended] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Paginated user list
 */
router.get(
  '/users',
  requireJwtAuth,
  requireRoles(...ALL_ADMINS),
  cacheServiceMiddleware('admin:users:list', 60),
  listUsers,
);

/**
 * @swagger
 * /admin/users/{publicKey}:
 *   get:
 *     summary: Get a single user's details
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: User details }
 *       404: { description: User not found }
 */
router.get(
  '/users/:publicKey',
  requireJwtAuth,
  requireRoles(...ALL_ADMINS),
  getUser,
);

/**
 * @swagger
 * /admin/users/{publicKey}/status:
 *   patch:
 *     summary: Suspend or activate a user
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isSuspended]
 *             properties:
 *               isSuspended: { type: boolean }
 *     responses:
 *       200: { description: Status updated }
 */
router.patch(
  '/users/:publicKey/status',
  requireJwtAuth,
  requireRoles(...PRIVILEGED_ADMINS),
  auditLog,
  idempotencyMiddleware,
  updateUserStatus,
);

/**
 * @swagger
 * /admin/users/{publicKey}/role:
 *   patch:
 *     summary: Change a user's role
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role: { type: string, enum: [admin, super_admin, ops, support, borrower, lender] }
 *     responses:
 *       200: { description: Role updated }
 */
router.patch(
  '/users/:publicKey/role',
  requireJwtAuth,
  requireRoles(...PRIVILEGED_ADMINS),
  auditLog,
  idempotencyMiddleware,
  updateUserRole,
);

/**
 * @swagger
 * /admin/kyc/override:
 *   post:
 *     summary: Override KYC verification status for a user
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [publicKey, verified]
 *             properties:
 *               publicKey: { type: string }
 *               verified: { type: boolean }
 *               level: { type: string }
 *     responses:
 *       200: { description: KYC status overridden }
 */
router.post(
  '/kyc/override',
  requireJwtAuth,
  requireRoles(...KYC_ADMINS),
  auditLog,
  idempotencyMiddleware,
  overrideKycStatus,
);

/**
 * @swagger
 * /admin/system/health:
 *   get:
 *     summary: Get system health status (DB, Redis, Stellar RPC, jobs)
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200: { description: Health report }
 */
router.get(
  '/system/health',
  requireJwtAuth,
  requireRoles(...ALL_ADMINS),
  cacheServiceMiddleware('admin:system:health', 30),
  getSystemHealth,
);

/**
 * @swagger
 * /admin/settlement/trigger:
 *   post:
 *     summary: Manually trigger batch settlement run
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               loanIds: { type: array, items: { type: integer } }
 *               force: { type: boolean }
 *     responses:
 *       200: { description: Settlement run completed }
 */
router.post(
  '/settlement/trigger',
  requireJwtAuth,
  requireRoles(...PRIVILEGED_ADMINS),
  auditLog,
  idempotencyMiddleware,
  triggerBatchSettlement,
);

/**
 * @swagger
 * /admin/feature-flags:
 *   get:
 *     summary: List all feature flags
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200: { description: Feature flags list }
 */
router.get('/feature-flags', requireJwtAuth, requireRoles(...ALL_ADMINS), listFeatureFlags);

/**
 * @swagger
 * /admin/feature-flags/{key}:
 *   put:
 *     summary: Update a feature flag's enabled state or value
 *     tags: [Admin]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled: { type: boolean }
 *               value: { type: string }
 *     responses:
 *       200: { description: Flag updated }
 *       404: { description: Flag not found }
 */
router.put(
  '/feature-flags/:key',
  requireJwtAuth,
  requireRoles(...PRIVILEGED_ADMINS),
  auditLog,
  idempotencyMiddleware,
  updateFeatureFlag,
);

export default router;
