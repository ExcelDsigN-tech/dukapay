import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../errors/AppError.js';
import { privacyService } from '../services/privacyService.js';
import logger from '../utils/logger.js';

/**
 * Authorization helper: checks that the authenticated user owns the target
 * publicKey, or has admin:privacy scope. Throws 403 if unauthorized.
 */
function authorizeDsar(req: Request, targetPublicKey: string): void {
  const authedUser = (req as any).user;
  if (!authedUser?.publicKey) {
    throw AppError.unauthorized('Authentication required');
  }

  // Admin with privacy scope can access any user's data
  if (authedUser.scopes?.includes('admin:privacy')) {
    logger.withContext().info('DSAR authorized via admin:privacy scope', {
      actor: authedUser.publicKey,
      target: targetPublicKey,
    });
    return;
  }

  // Regular users can only access their own data
  if (authedUser.publicKey !== targetPublicKey) {
    logger.withContext().warn('DSAR unauthorized: cross-user access attempt', {
      actor: authedUser.publicKey,
      target: targetPublicKey,
    });
    throw AppError.forbidden('You can only submit DSAR requests for your own data');
  }
}

export const createDsarAccessRequest = asyncHandler(async (req: Request, res: Response) => {
  const { publicKey, reason } = req.body;

  if (!publicKey) {
    throw AppError.badRequest('publicKey is required');
  }

  authorizeDsar(req, publicKey);

  const dsar = await privacyService.createDsarRequest(publicKey, 'access', reason);

  logger.withContext().info('DSAR access request created', {
    dsarId: dsar.id,
    publicKey,
    actor: (req as any).user?.publicKey,
  });

  res.status(201).json({
    success: true,
    message: 'Data access request created. We will process your request within 30 days.',
    dsar: {
      id: dsar.id,
      type: dsar.type,
      status: dsar.status,
      createdAt: dsar.createdAt,
    },
  });
});

export const createDsarDeletionRequest = asyncHandler(async (req: Request, res: Response) => {
  const { publicKey, reason } = req.body;

  if (!publicKey) {
    throw AppError.badRequest('publicKey is required');
  }

  authorizeDsar(req, publicKey);

  const dsar = await privacyService.createDsarRequest(publicKey, 'deletion', reason);

  logger.withContext().info('DSAR deletion request created', {
    dsarId: dsar.id,
    publicKey,
    actor: (req as any).user?.publicKey,
  });

  // Start async deletion process
  privacyService
    .deleteUserData(publicKey)
    .then(async (result) => {
      await privacyService.getDsarRequest(dsar.id);
      logger.withContext().info('DSAR deletion completed', {
        dsarId: dsar.id,
        recordsAnonymized: result.recordsAnonymized,
      });
    })
    .catch((error) => {
      logger.withContext().error('DSAR deletion failed', {
        dsarId: dsar.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  res.status(201).json({
    success: true,
    message:
      'Data deletion request created. Your PII will be removed within 30 days. Financial records will be anonymized.',
    dsar: {
      id: dsar.id,
      type: dsar.type,
      status: dsar.status,
      createdAt: dsar.createdAt,
    },
  });
});

export const createAnonymizationRequest = asyncHandler(async (req: Request, res: Response) => {
  const { publicKey, reason } = req.body;

  const dsar = await privacyService.createDsarRequest(publicKey, 'anonymization', reason);

  privacyService
    .anonymizeUserData(publicKey)
    .then(async () => {
      logger.withContext().info('Anonymization completed', { dsarId: dsar.id });
    })
    .catch((error) => {
      logger.withContext().error('Anonymization failed', {
        dsarId: dsar.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  res.status(201).json({
    success: true,
    message: 'Data anonymization request created. Your data will be anonymized within 30 days.',
    dsar: {
      id: dsar.id,
      type: dsar.type,
      status: dsar.status,
      createdAt: dsar.createdAt,
    },
  });
});

export const exportUserData = asyncHandler(async (req: Request, res: Response) => {
  const paramVal = req.params.publicKey;
  const publicKey = Array.isArray(paramVal) ? paramVal[0] : paramVal;
  if (!publicKey) {
    throw AppError.badRequest('publicKey parameter is required');
  }

  authorizeDsar(req, publicKey);

  const data = await privacyService.exportUserData(publicKey);

  res.json({
    success: true,
    exportedAt: new Date().toISOString(),
    data,
  });
});

export const getDsarStatus = asyncHandler(async (req: Request, res: Response) => {
  const paramVal = req.params.dsarId;
  const dsarId = Array.isArray(paramVal) ? paramVal[0] : paramVal;
  if (!dsarId) {
    throw AppError.badRequest('dsarId parameter is required');
  }

  const dsar = await privacyService.getDsarRequest(dsarId);
  if (!dsar) {
    throw AppError.notFound('DSAR request not found');
  }

  res.json({
    success: true,
    dsar,
  });
});

export const getPendingDsars = asyncHandler(async (_req: Request, res: Response) => {
  const dsars = await privacyService.getPendingDsars();

  res.json({
    success: true,
    dsars,
    total: dsars.length,
  });
});
