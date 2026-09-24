import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/errorCodes.js';
import logger from '../utils/logger.js';
import { Sentry } from '../config/sentry.js';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Sanitize an error message for client consumption (issue #409).
 *
 * In production, internal errors return a generic message. Operational
 * errors (bad request, not found, etc.) still return their specific
 * message because they're expected failures — not information leaks.
 *
 * The correlation ID (`requestId`) is always included so operators can
 * trace the full error in server logs without exposing internals.
 */
function clientMessage(err: Error, isOperational: boolean): string {
  if (isOperational) return err.message;
  // Non-operational errors: never leak internals in production
  if (isProduction) return 'Internal server error';
  // Development: include the original message for debugging
  return err.message;
}

/**
 * Global error handling middleware.
 *
 * Must be registered LAST in the Express middleware chain (after all
 * routes). Catches all errors forwarded via `next(err)` and returns
 * a consistent JSON error response with structured error codes.
 *
 * Every response includes a `requestId` correlation field (issue #409)
 * so that client-side error reports can be matched to server logs
 * without exposing internal paths, stack traces, or PII.
 */
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const requestId = (req as { requestId?: string }).requestId;

  // ── Zod Validation Errors ────────────────────────────────────
  if (err instanceof z.ZodError) {
    const details = err.issues.map((issue: z.ZodIssue) => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));

    const firstField = details.length > 0 ? details[0]?.field : undefined;

    logger.warn('Validation error', {
      requestId,
      path: req.path,
      method: req.method,
      fieldCount: details.length,
    });

    res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: err.issues.map((issue: z.ZodIssue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        field: firstField,
        details,
      },
      requestId,
    });
    return;
  }

  // ── Known Operational Errors ─────────────────────────────────
  if (err instanceof AppError) {
    if (!err.isOperational) {
      logger.error(`Internal AppError: ${err.message}`, {
        requestId,
        path: req.path,
        method: req.method,
        stack: err.stack,
      });
      Sentry.captureException(err, {
        extra: { requestId, path: req.path, method: req.method },
      });
    }

    const message = clientMessage(err, err.isOperational);

    const errorDetail: Record<string, unknown> = {
      code: err.errorCode,
      message,
    };

    const errorResponse: Record<string, unknown> = {
      success: false,
      message,
      error: errorDetail,
      requestId,
    };

    if (err.field) {
      errorDetail.field = err.field;
      errorResponse.field = err.field;
    }

    if (err.details) {
      errorDetail.details = err.details;
    }

    res.status(err.statusCode).json(errorResponse);
    return;
  }

  // ── Payload Too Large (body-parser) ────────────────────────
  if ('type' in err && (err as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({
      success: false,
      message: 'Request payload too large',
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Request payload too large',
      },
      requestId,
    });
    return;
  }

  // ── Unexpected / Programming Errors ──────────────────────────
  // Log full context server-side with correlation ID; return generic message
  logger.error('Unhandled error', {
    requestId,
    message: err.message,
    name: err.name,
    path: req.path,
    method: req.method,
    ...(err.stack && { stack: err.stack }),
  });

  Sentry.captureException(err, {
    extra: { requestId, path: req.path, method: req.method },
  });

  const shouldExposeDetails = !isProduction && process.env.EXPOSE_STACK_TRACES === 'true';

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: shouldExposeDetails ? err.message : 'Internal server error',
    },
    requestId,
    ...(shouldExposeDetails && { stack: err.stack }),
  });
};
