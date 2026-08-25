import { Router } from 'express';
import {
  createDsarAccessRequest,
  createDsarDeletionRequest,
  createAnonymizationRequest,
  exportUserData,
  getDsarStatus,
  getPendingDsars,
} from '../controllers/privacyController.js';
import { validate } from '../middleware/validation.js';
import {
  dsarAccessSchema,
  dsarDeleteSchema,
  anonymizeSchema,
  exportDataSchema,
} from '../schemas/privacySchemas.js';
import { requireJwtAuth } from '../middleware/jwtAuth.js';
import { requireApiKey } from '../middleware/auth.js';
import { strictRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

/**
 * @swagger
 * /privacy/dsar/access:
 *   post:
 *     summary: Request a copy of your data (DSAR - Data Subject Access Request)
 *     description: |
 *       GDPR Art. 15 / CCPA right-to-know. Creates a DSAR access request.
 *       The platform will prepare an export of all your data within 30 days.
 *     tags: [Privacy]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - publicKey
 *               - reason
 *             properties:
 *               publicKey:
 *                 type: string
 *               reason:
 *                 type: string
 *                 minLength: 10
 *     responses:
 *       201:
 *         description: DSAR request created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.post(
  '/dsar/access',
  strictRateLimiter,
  requireJwtAuth,
  validate(dsarAccessSchema),
  createDsarAccessRequest,
);

/**
 * @swagger
 * /privacy/dsar/delete:
 *   post:
 *     summary: Request deletion of your data (Right to be Forgotten)
 *     description: |
 *       GDPR Art. 17 / CCPA right-to-delete. Removes PII while preserving
 *       anonymized financial records for accounting compliance.
 *     tags: [Privacy]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - publicKey
 *               - reason
 *               - confirmDeletion
 *             properties:
 *               publicKey:
 *                 type: string
 *               reason:
 *                 type: string
 *                 minLength: 10
 *               confirmDeletion:
 *                 type: boolean
 *                 enum: [true]
 *     responses:
 *       201:
 *         description: Deletion request created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.post(
  '/dsar/delete',
  strictRateLimiter,
  requireJwtAuth,
  validate(dsarDeleteSchema),
  createDsarDeletionRequest,
);

/**
 * @swagger
 * /privacy/anonymize:
 *   post:
 *     summary: Anonymize your data for analytics
 *     description: |
 *       Replaces PII with consistent hashes while preserving behavioral
 *       patterns for aggregate analytics.
 *     tags: [Privacy]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - publicKey
 *               - reason
 *             properties:
 *               publicKey:
 *                 type: string
 *               reason:
 *                 type: string
 *                 minLength: 10
 *     responses:
 *       201:
 *         description: Anonymization request created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Authentication required
 */
router.post(
  '/anonymize',
  strictRateLimiter,
  requireJwtAuth,
  validate(anonymizeSchema),
  createAnonymizationRequest,
);

/**
 * @swagger
 * /privacy/export/{publicKey}:
 *   get:
 *     summary: Export all your data
 *     description: |
 *       Returns all data associated with the given public key in JSON format.
 *       Includes profile, scores, loan events, remittances, and audit logs.
 *     tags: [Privacy]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Data export
 *       401:
 *         description: Authentication required
 *       404:
 *         description: User not found
 */
router.get(
  '/export/:publicKey',
  strictRateLimiter,
  requireJwtAuth,
  validate(exportDataSchema),
  exportUserData,
);

/**
 * @swagger
 * /privacy/dsar/{dsarId}:
 *   get:
 *     summary: Check DSAR request status
 *     tags: [Privacy]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: dsarId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: DSAR status
 *       404:
 *         description: DSAR not found
 */
router.get(
  '/dsar/:dsarId',
  requireJwtAuth,
  getDsarStatus,
);

/**
 * @swagger
 * /privacy/dsar/pending:
 *   get:
 *     summary: List pending DSAR requests (admin only)
 *     tags: [Privacy]
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of pending DSARs
 */
router.get(
  '/dsar/pending',
  requireApiKey('admin:privacy'),
  getPendingDsars,
);

export default router;
