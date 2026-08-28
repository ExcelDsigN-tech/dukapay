import { createClient, type RedisClientType } from 'redis';
import logger from '../utils/logger.js';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CacheMetrics {
  hits: number;
  misses: number;
  hitRate: number;
  totalRequests: number;
  avgLatencyMs: number;
  circuitState: CircuitState;
  failureCount: number;
}

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

class RedisCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount: number = 0;
  private successCount: number = 0;
  private readonly failureThreshold: number = 5;
  private readonly resetTimeoutMs: number = 10000; // 10s before HALF_OPEN
  private lastStateChangeTime: number = Date.now();

  private hits: number = 0;
  private misses: number = 0;
  private totalLatencyMs: number = 0;
  private totalOperations: number = 0;

  getState(): CircuitState {
    if (this.state === 'OPEN' && Date.now() - this.lastStateChangeTime > this.resetTimeoutMs) {
      this.state = 'HALF_OPEN';
      this.lastStateChangeTime = Date.now();
      logger.withContext().warn('Redis Circuit Breaker transitioning from OPEN to HALF_OPEN');
    }
    return this.state;
  }

  recordSuccess(latencyMs: number, hit?: boolean): void {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= 2) {
        this.state = 'CLOSED';
        this.successCount = 0;
        this.lastStateChangeTime = Date.now();
        logger.withContext().info('Redis Circuit Breaker reset to CLOSED');
      }
    }
    this.totalOperations++;
    this.totalLatencyMs += latencyMs;
    if (hit === true) this.hits++;
    if (hit === false) this.misses++;
  }

  recordFailure(err: unknown): void {
    this.failureCount++;
    this.totalOperations++;
    logger.withContext().error('Redis operation failure recorded', { error: err, failures: this.failureCount });

    if (this.failureCount >= this.failureThreshold && this.state !== 'OPEN') {
      this.state = 'OPEN';
      this.lastStateChangeTime = Date.now();
      logger.withContext().error('Redis Circuit Breaker tripped to OPEN due to consecutive failures');
    }
  }

  getMetrics(): CacheMetrics {
    const totalRequests = this.hits + this.misses;
    const hitRate = totalRequests > 0 ? parseFloat((this.hits / totalRequests).toFixed(4)) : 0;
    const avgLatencyMs = this.totalOperations > 0 ? parseFloat((this.totalLatencyMs / this.totalOperations).toFixed(2)) : 0;

    return {
      hits: this.hits,
      misses: this.misses,
      hitRate,
      totalRequests,
      avgLatencyMs,
      circuitState: this.getState(),
      failureCount: this.failureCount,
    };
  }
}

export const redisCircuitBreaker = new RedisCircuitBreaker();

export const redisClient: RedisClientType = createClient({
  url: REDIS_URL,
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  },
});

redisClient.on('error', (err) => {
  if (process.env.NODE_ENV !== 'test') {
    logger.withContext().error('Redis Client Error', err);
  }
  redisCircuitBreaker.recordFailure(err);
});

redisClient.on('connect', () => {
  if (process.env.NODE_ENV !== 'test') {
    logger.withContext().info('Redis Client Connected with Connection Pool');
  }
});

/**
 * Cache-aside decorator / wrapper for expensive query execution.
 * Respects circuit breaker state to fallback directly to fallbackFn when Redis fails.
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fallbackFn: () => Promise<T>,
): Promise<T> {
  const startTime = Date.now();

  if (redisCircuitBreaker.getState() === 'OPEN' || (process.env.NODE_ENV === 'test' && !redisClient.isOpen)) {
    return fallbackFn();
  }

  try {
    if (!redisClient.isOpen) {
      await Promise.race([
        redisClient.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 500)),
      ]).catch(() => {});
    }

    if (!redisClient.isOpen) {
      return fallbackFn();
    }

    const cachedData = await redisClient.get(key);
    const latency = Date.now() - startTime;

    if (cachedData) {
      redisCircuitBreaker.recordSuccess(latency, true);
      return JSON.parse(cachedData) as T;
    }

    redisCircuitBreaker.recordSuccess(latency, false);
  } catch (err) {
    redisCircuitBreaker.recordFailure(err);
    return fallbackFn();
  }

  // Fetch fresh data from DB / fallback source
  const freshData = await fallbackFn();

  // Populate cache asynchronously without blocking caller
  if (redisCircuitBreaker.getState() !== 'OPEN' && redisClient.isOpen) {
    redisClient
      .setEx(key, ttlSeconds, JSON.stringify(freshData))
      .catch((err) => redisCircuitBreaker.recordFailure(err));
  }

  return freshData;
}

/**
 * Cache invalidation helper
 */
export async function invalidateCacheKeys(...keys: string[]): Promise<void> {
  if (redisCircuitBreaker.getState() === 'OPEN' || !keys.length || !redisClient.isOpen) return;
  try {
    await redisClient.del(keys);
  } catch (err) {
    redisCircuitBreaker.recordFailure(err);
  }
}
