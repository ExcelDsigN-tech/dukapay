import { createClient, type RedisClientType } from 'redis';
import crypto from 'node:crypto';
import logger from '../utils/logger.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export enum RateLimitTier {
  ANONYMOUS = 'anonymous',
  AUTHENTICATED = 'authenticated',
  PREMIUM = 'premium',
  INTERNAL = 'internal',
}

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  currentCount: number;
  limit: number;
  tier?: RateLimitTier | undefined;
}

export const TIER_LIMITS: Record<RateLimitTier, RateLimitConfig> = {
  [RateLimitTier.ANONYMOUS]: { maxRequests: 30, windowSeconds: 60 }, // 30 req/min per IP
  [RateLimitTier.AUTHENTICATED]: { maxRequests: 100, windowSeconds: 60 }, // 100 req/min per user
  [RateLimitTier.PREMIUM]: { maxRequests: 1000, windowSeconds: 60 }, // 1000 req/min per API key
  [RateLimitTier.INTERNAL]: { maxRequests: 10000, windowSeconds: 60 }, // 10000 req/min per service
};

// Strict limits for expensive operations
export const EXPENSIVE_OPERATION_LIMITS = {
  SEARCH: { maxRequests: 10, windowSeconds: 60 }, // 10 req/min
  LOAN_APPLICATION: { maxRequests: 5, windowSeconds: 60 }, // 5 req/min
  SCORE_UPDATE: { maxRequests: 5, windowSeconds: 86400 }, // 5 req/day
};

export const SCORE_UPDATE_RATE_LIMIT = EXPENSIVE_OPERATION_LIMITS.SCORE_UPDATE;

/**
 * Redis-based sliding window rate limiting service for API endpoints.
 * Supports tiered rate limits and fallback in-memory sliding window.
 */
class RateLimitService {
  private static readonly DEFAULT_CONFIG: RateLimitConfig = TIER_LIMITS[RateLimitTier.ANONYMOUS];

  private static readonly SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowSeconds = tonumber(ARGV[2])
local maxRequests = tonumber(ARGV[3])
local member = ARGV[4]

local clearBefore = now - windowSeconds
redis.call('ZREMRANGEBYSCORE', key, 0, clearBefore)
local currentCount = redis.call('ZCARD', key)

if currentCount < maxRequests then
  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, math.ceil(windowSeconds))
  local remaining = maxRequests - currentCount - 1
  return {1, remaining, currentCount + 1, now + windowSeconds}
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldestScore = now
  if oldest and oldest[2] then
    oldestScore = tonumber(oldest[2])
  end
  local resetTime = oldestScore + windowSeconds
  return {0, 0, currentCount, resetTime}
end
`;

  private client: RedisClientType;
  private isConnected = false;
  // In-memory sliding window timestamps: Map<key, Array<timestampMs>>
  private inMemoryWindows = new Map<string, number[]>();

  constructor() {
    this.client = createClient({ url: REDIS_URL });
    this.client.on('error', (error) => {
      this.isConnected = false;
      if (process.env.NODE_ENV !== 'test') {
        logger.withContext().error('Rate limit Redis client error', { error });
      }
    });
    this.client.on('connect', () => {
      this.isConnected = true;
    });
  }

  private async ensureConnected(): Promise<void> {
    if (!this.isConnected) {
      await this.client.connect();
    }
  }

  /**
   * Resolves the rate limit tier for a request.
   */
  resolveTier(req: {
    user?: { publicKey?: string };
    headers?: Record<string, string | string[] | undefined>;
  }): { tier: RateLimitTier; identifier: string } {
    const apiKey = (req.headers?.['x-api-key'] as string | undefined)?.trim();

    if (apiKey) {
      if (apiKey.startsWith('internal:') || apiKey.startsWith('admin:')) {
        return { tier: RateLimitTier.INTERNAL, identifier: `svc:${apiKey.split(':')[0]}` };
      }
      return { tier: RateLimitTier.PREMIUM, identifier: `key:${apiKey}` };
    }

    if (req.user?.publicKey) {
      return { tier: RateLimitTier.AUTHENTICATED, identifier: `user:${req.user.publicKey}` };
    }

    return { tier: RateLimitTier.ANONYMOUS, identifier: 'anon' };
  }

  /**
   * Check if a request is allowed based on rate limit rules using sliding window.
   */
  async checkRateLimit(
    identifier: string,
    config: RateLimitConfig = RateLimitService.DEFAULT_CONFIG,
    tier?: RateLimitTier,
  ): Promise<RateLimitResult> {
    const key = `rate_limit:${identifier}`;
    const nowSeconds = Date.now() / 1000;
    const member = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    try {
      await this.ensureConnected();

      const [allowedNum, remaining, currentCount, resetTimeSeconds] = (await this.client.eval(
        RateLimitService.SLIDING_WINDOW_SCRIPT,
        {
          keys: [key],
          arguments: [
            String(nowSeconds),
            String(config.windowSeconds),
            String(config.maxRequests),
            member,
          ],
        },
      )) as [number, number, number, number];

      const allowed = allowedNum === 1;
      const resetTime = new Date((resetTimeSeconds || nowSeconds + config.windowSeconds) * 1000);

      return {
        allowed,
        remaining: Math.max(0, remaining),
        resetTime,
        currentCount,
        limit: config.maxRequests,
        tier,
      };
    } catch {
      // In-memory sliding window fallback
      return this.checkInMemorySlidingWindow(key, config, tier);
    }
  }

  /**
   * In-memory sliding window fallback when Redis is unavailable.
   */
  private checkInMemorySlidingWindow(
    key: string,
    config: RateLimitConfig,
    tier?: RateLimitTier,
  ): RateLimitResult {
    const nowMs = Date.now();
    const windowMs = config.windowSeconds * 1000;
    const thresholdMs = nowMs - windowMs;

    let timestamps = this.inMemoryWindows.get(key) ?? [];
    // Prune entries outside the sliding window
    timestamps = timestamps.filter((t) => t > thresholdMs);

    if (timestamps.length < config.maxRequests) {
      timestamps.push(nowMs);
      this.inMemoryWindows.set(key, timestamps);

      const oldest = timestamps[0] ?? nowMs;
      const resetTime = new Date(oldest + windowMs);

      return {
        allowed: true,
        remaining: config.maxRequests - timestamps.length,
        resetTime,
        currentCount: timestamps.length,
        limit: config.maxRequests,
        tier,
      };
    }

    const oldest = timestamps[0] ?? nowMs;
    const resetTime = new Date(oldest + windowMs);

    return {
      allowed: false,
      remaining: 0,
      resetTime,
      currentCount: timestamps.length,
      limit: config.maxRequests,
      tier,
    };
  }

  /**
   * Reset rate limit counter for a specific identifier.
   */
  async resetRateLimit(identifier: string): Promise<void> {
    const key = `rate_limit:${identifier}`;
    this.inMemoryWindows.delete(key);
    try {
      await this.ensureConnected();
      await this.client.del(key);
      logger.withContext().info('Rate limit reset', { identifier });
    } catch {
      // ignore
    }
  }

  /**
   * Get current rate limit status without incrementing.
   */
  async getRateLimitStatus(
    identifier: string,
    config: RateLimitConfig = RateLimitService.DEFAULT_CONFIG,
  ): Promise<Omit<RateLimitResult, 'currentCount'>> {
    const key = `rate_limit:${identifier}`;
    const nowSeconds = Date.now() / 1000;
    const windowSeconds = config.windowSeconds;

    try {
      await this.ensureConnected();
      const currentCount = await this.client.zCard(key);
      const remaining = Math.max(0, config.maxRequests - currentCount);
      const resetTime = new Date((nowSeconds + windowSeconds) * 1000);

      return {
        allowed: currentCount < config.maxRequests,
        remaining,
        resetTime,
        limit: config.maxRequests,
      };
    } catch {
      const nowMs = Date.now();
      const timestamps = (this.inMemoryWindows.get(key) ?? []).filter(
        (t) => t > nowMs - windowSeconds * 1000,
      );
      const remaining = Math.max(0, config.maxRequests - timestamps.length);
      return {
        allowed: timestamps.length < config.maxRequests,
        remaining,
        resetTime: new Date(nowMs + windowSeconds * 1000),
        limit: config.maxRequests,
      };
    }
  }
}

// Export singleton instance
export const rateLimitService = new RateLimitService();
