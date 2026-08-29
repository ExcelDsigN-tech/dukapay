import { Router } from 'express';
import { requireApiKey } from '../middleware/auth.js';
import { auditMerkleService } from '../services/auditMerkleService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../errors/AppError.js';

const router = Router();

/**
 * @swagger
 * /audit/proof/{logId}:
 *   get:
 *     summary: Get the Merkle inclusion proof for an audit log
 *     description: >
 *       Returns the Merkle proof that places the given audit log at position
 *       `logId` within the audit Merkle tree, along with the current tree
 *       root. Requires an `admin:audit` scoped API key.
 *     tags: [Audit]
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: logId
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Audit log ID (must be a positive integer)
 *     responses:
 *       200:
 *         description: Merkle proof retrieved successfully.
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
 *                   required: [leaf, path, root]
 *                   properties:
 *                     leaf:
 *                       type: string
 *                       description: Hashing of the audit log record
 *                     path:
 *                       type: array
 *                       items:
 *                         type: object
 *                         required: [hash, position]
 *                         properties:
 *                           hash:
 *                             type: string
 *                           position:
 *                             type: string
 *                             enum: [left, right]
 *                     root:
 *                       type: string
 *                       description: Current Merkle tree root
 *       400:
 *         description: Invalid log ID.
 *       401:
 *         description: Unauthorised — missing or invalid API key.
 *       404:
 *         description: Audit proof not found.
 */
router.get(
  '/proof/:logId',
  requireApiKey('admin:audit'),
  asyncHandler(async (req, res) => {
    const logId = Number(req.params.logId);
    if (!Number.isSafeInteger(logId) || logId <= 0) throw AppError.badRequest('Invalid log ID');
    const proof = await auditMerkleService.getProof(logId);
    if (!proof) throw AppError.notFound('Audit proof not found');
    res.json({ success: true, data: proof });
  }),
);

export default router;
