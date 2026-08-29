import type { Request, Response, NextFunction } from 'express';
import {
  rateLimitService,
  RateLimitTier,
  TIER_LIMITS,
  EXPENSIVE_OPERATION_LIMITS,
  SCORE_UPDATE_RATE_LIMIT,
  type RateLimitConfig,
} from '../services/rateLimitService.js';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/errorCodes.js';
import logger from '../utils/logger.js';

/**
 * Rate limiting middleware configuration options
 */
export interface RateLimitMiddlewareOptions {
  getIdentifier?: (req: Request) => string;
  config?: RateLimitConfig;
  tier?: RateLimitTier;
  skipIf?: (req: Request) => boolean;
  errorMessage?: string;
}

/**
 * Creates a rate limiting middleware for Express endpoints.
 * Uses Redis sliding window counters with TTL expiry.
 */
export const createRateLimitMiddleware = (options: RateLimitMiddlewareOptions = {}) => {
  const {
    getIdentifier = (req: Request) => {
      const body = req.body as { userId?: string } | undefined;
      if (!body?.userId) {
        throw new Error('Rate limiting middleware requires userId in request body');
      }
      return body.userId;
    },
    config = SCORE_UPDATE_RATE_LIMIT,
    skipIf = () => false,
    errorMessage = 'Rate limit exceeded. Please try again later.',
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (skipIf(req)) {
        return next();
      }

      let identifier: string;
      try {
        identifier = getIdentifier(req);
      } catch (err) {
        // Fail open if identifier resolution fails
        logger.warn('Failed to extract rate limit identifier, failing open', { error: err });
        return next();
      }

      const result = options.tier
        ? await rateLimitService.checkRateLimit(identifier, config, options.tier)
        : await rateLimitService.checkRateLimit(identifier, config);

      // Add standard rate limit headers to response
      res.set({
        'X-RateLimit-Limit': config.maxRequests.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': Math.ceil(result.resetTime.getTime() / 1000).toString(),
        'X-RateLimit-Used': result.currentCount.toString(),
      });

      if (!result.allowed) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((result.resetTime.getTime() - Date.now()) / 1000),
        );
        res.set('Retry-After', retryAfterSeconds.toString());

        logger.warn('Rate limit exceeded', {
          identifier,
          currentCount: result.currentCount,
          maxRequests: config.maxRequests,
          resetTime: result.resetTime,
          path: req.path,
          method: req.method,
        });

        throw AppError.withCode(ErrorCode.RATE_LIMIT_EXCEEDED, errorMessage);
      }

      // Log rate limit status for monitoring
      if (result.remaining <= Math.ceil(config.maxRequests * 0.1)) {
        logger.info('Rate limit nearing exhaustion', {
          identifier,
          remaining: result.remaining,
          maxRequests: config.maxRequests,
          resetTime: result.resetTime,
          path: req.path,
        });
      }

      next();
    } catch (error) {
      if (error instanceof AppError) {
        return next(error);
      }

      logger.error('Rate limiting middleware error', {
        error: error instanceof Error ? error.message : String(error),
        path: req.path,
        method: req.method,
      });

      next();
    }
  };
};

/**
 * Universal Tiered Rate Limiting Middleware.
 * Automatically resolves client tier:
 * - Anonymous (30 req/min by IP)
 * - Authenticated (100 req/min by user public key)
 * - Premium (1,000 req/min by API key)
 * - Internal (10,000 req/min by internal service key)
 */
export const tieredRateLimiter = (options: { overrideConfig?: RateLimitConfig } = {}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tier, identifier } = rateLimitService.resolveTier(req);
      const config = options.overrideConfig ?? TIER_LIMITS[tier];

      const effectiveIdentifier =
        tier === RateLimitTier.ANONYMOUS
          ? `ip:${req.ip || req.connection.remoteAddress || 'unknown'}`
          : identifier;

      const result = await rateLimitService.checkRateLimit(effectiveIdentifier, config, tier);

      res.set({
        'X-RateLimit-Limit': config.maxRequests.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': Math.ceil(result.resetTime.getTime() / 1000).toString(),
        'X-RateLimit-Used': result.currentCount.toString(),
      });

      if (!result.allowed) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((result.resetTime.getTime() - Date.now()) / 1000),
        );
        res.set('Retry-After', retryAfterSeconds.toString());

        logger.warn('Tiered rate limit exceeded', {
          tier,
          identifier: effectiveIdentifier,
          currentCount: result.currentCount,
          maxRequests: config.maxRequests,
          resetTime: result.resetTime,
          path: req.path,
        });

        throw AppError.withCode(
          ErrorCode.RATE_LIMIT_EXCEEDED,
          `Rate limit exceeded for ${tier} tier. Maximum ${config.maxRequests} requests per minute.`,
        );
      }

      next();
    } catch (error) {
      if (error instanceof AppError) {
        return next(error);
      }

      logger.error('Tiered rate limiting error', {
        error: error instanceof Error ? error.message : String(error),
        path: req.path,
      });

      next();
    }
  };
};

/**
 * Strict rate limiting middleware for expensive search operations (10 req/min).
 */
export const searchRateLimit = createRateLimitMiddleware({
  getIdentifier: (req: Request) => {
    const user = (req as unknown as { user?: { publicKey: string } }).user;
    return user?.publicKey ? `search:user:${user.publicKey}` : `search:ip:${req.ip || 'unknown'}`;
  },
  config: EXPENSIVE_OPERATION_LIMITS.SEARCH,
  errorMessage: 'Too many search requests. Maximum 10 searches allowed per minute.',
});

/**
 * Strict rate limiting middleware for loan applications (5 req/min).
 */
export const loanApplicationRateLimit = createRateLimitMiddleware({
  getIdentifier: (req: Request) => {
    const user = (req as unknown as { user?: { publicKey: string } }).user;
    return user?.publicKey ? `loan:user:${user.publicKey}` : `loan:ip:${req.ip || 'unknown'}`;
  },
  config: EXPENSIVE_OPERATION_LIMITS.LOAN_APPLICATION,
  errorMessage: 'Too many loan applications. Maximum 5 loan applications allowed per minute.',
});

/**
 * Pre-configured rate limiting middleware for score update endpoints.
 * Limits to 5 score updates per user per day.
 */
export const scoreUpdateRateLimit = createRateLimitMiddleware({
  config: SCORE_UPDATE_RATE_LIMIT,
  errorMessage: 'Too many score updates. Maximum 5 updates allowed per user per day.',
});

/**
 * Rate limiting middleware that uses IP address as identifier.
 */
export const createIpRateLimitMiddleware = (
  maxRequests: number = 100,
  windowSeconds: number = 3600, // 1 hour
) =>
  createRateLimitMiddleware({
    getIdentifier: (req: Request) => {
      const ip = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
      if (!ip) {
        throw new Error('Unable to determine client IP address for rate limiting');
      }
      return `ip:${ip}`;
    },
    config: { maxRequests, windowSeconds },
    errorMessage: `Too many requests. Maximum ${maxRequests} requests allowed per hour.`,
  });
