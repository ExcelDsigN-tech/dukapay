import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../errors/AppError.js';
import { privacyService } from '../services/privacyService.js';
import logger from '../utils/logger.js';

export const createDsarAccessRequest = asyncHandler(async (req: Request, res: Response) => {
  const { publicKey, reason } = req.body;

  const dsar = await privacyService.createDsarRequest(publicKey, 'access', reason);

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

  const dsar = await privacyService.createDsarRequest(publicKey, 'deletion', reason);

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
  const { publicKey } = req.params;

  const data = await privacyService.exportUserData(publicKey);

  res.json({
    success: true,
    exportedAt: new Date().toISOString(),
    data,
  });
});

export const getDsarStatus = asyncHandler(async (req: Request, res: Response) => {
  const { dsarId } = req.params;

  const dsar = await privacyService.getDsarRequest(dsarId);
  if (!dsar) {
    throw AppError.notFound('DSAR request not found');
  }

  res.json({
    success: true,
    dsar,
  });
});

export const getPendingDsars = asyncHandler(async (req: Request, res: Response) => {
  const dsars = await privacyService.getPendingDsars();

  res.json({
    success: true,
    dsars,
    total: dsars.length,
  });
});
