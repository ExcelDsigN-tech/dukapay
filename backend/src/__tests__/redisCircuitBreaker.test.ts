import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { redisCircuitBreaker, withCache } from '../config/redis.js';

describe('Redis Circuit Breaker & Caching Layer', () => {
  beforeEach(() => {
    // Reset circuit breaker metrics between tests
    (redisCircuitBreaker as any).state = 'CLOSED';
    (redisCircuitBreaker as any).failureCount = 0;
    (redisCircuitBreaker as any).hits = 0;
    (redisCircuitBreaker as any).misses = 0;
    (redisCircuitBreaker as any).totalOperations = 0;
  });

  it('starts in CLOSED state with 0 failures', () => {
    expect(redisCircuitBreaker.getState()).toBe('CLOSED');
    const metrics = redisCircuitBreaker.getMetrics();
    expect(metrics.circuitState).toBe('CLOSED');
    expect(metrics.failureCount).toBe(0);
  });

  it('trips to OPEN state after 5 consecutive failures', () => {
    for (let i = 0; i < 5; i++) {
      redisCircuitBreaker.recordFailure(new Error('Connection error'));
    }
    expect(redisCircuitBreaker.getState()).toBe('OPEN');
    expect(redisCircuitBreaker.getMetrics().circuitState).toBe('OPEN');
  });

  it('bypasses Redis and uses fallback when circuit is OPEN', async () => {
    for (let i = 0; i < 5; i++) {
      redisCircuitBreaker.recordFailure(new Error('Redis down'));
    }

    const fallbackFn = jest.fn<() => Promise<string>>().mockResolvedValue('fallback_data');
    const result = await withCache('test_key', 60, fallbackFn);

    expect(result).toBe('fallback_data');
    expect(fallbackFn).toHaveBeenCalledTimes(1);
  });

  it('calculates hit rate and average latency correctly', () => {
    redisCircuitBreaker.recordSuccess(10, true);
    redisCircuitBreaker.recordSuccess(20, false);
    redisCircuitBreaker.recordSuccess(15, true);

    const metrics = redisCircuitBreaker.getMetrics();
    expect(metrics.hits).toBe(2);
    expect(metrics.misses).toBe(1);
    expect(metrics.totalRequests).toBe(3);
    expect(metrics.hitRate).toBe(0.6667);
    expect(metrics.avgLatencyMs).toBe(15);
  });
});
