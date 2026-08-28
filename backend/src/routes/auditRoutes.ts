import { Router } from 'express';
import { requireApiKey } from '../middleware/auth.js';
import { auditMerkleService } from '../services/auditMerkleService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../errors/AppError.js';

const router = Router();

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
