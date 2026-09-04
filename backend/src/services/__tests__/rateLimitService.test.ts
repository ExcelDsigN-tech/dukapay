import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const mockConnect = jest.fn<() => Promise<void>>();
const mockOn = jest.fn();
const mockEval =
  jest.fn<(script: string, options: { keys: string[]; arguments: string[] }) => Promise<unknown>>();
const mockTtl = jest.fn<(key: string) => Promise<number>>();
const mockGet = jest.fn<(key: string) => Promise<string | null>>();
const mockDel = jest.fn<(key: string) => Promise<number>>();
const mockZCard = jest.fn<(key: string) => Promise<number>>();

jest.unstable_mockModule('redis', () => ({
  createClient: () => ({
    connect: mockConnect,
    on: mockOn,
    eval: mockEval,
    ttl: mockTtl,
    get: mockGet,
    del: mockDel,
    zCard: mockZCard,
  }),
}));

const {
  rateLimitService,
  RateLimitTier,
  TIER_LIMITS,
  EXPENSIVE_OPERATION_LIMITS,
  SCORE_UPDATE_RATE_LIMIT,
} = await import('../rateLimitService.js');

describe('rateLimitService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockEval.mockResolvedValue([1, 59, 1, 60]);
    mockTtl.mockResolvedValue(60);
    mockGet.mockResolvedValue(null);
    mockDel.mockResolvedValue(1);
    mockZCard.mockResolvedValue(0);
  });

  describe('Tier Resolution', () => {
    it('resolves internal tier for internal API keys', () => {
      const { tier, identifier } = rateLimitService.resolveTier({
        headers: { 'x-api-key': 'internal:metrics-svc' },
      });
      expect(tier).toBe(RateLimitTier.INTERNAL);
      expect(identifier).toBe('svc:internal');
    });

    it('resolves premium tier for custom API keys', () => {
      const { tier, identifier } = rateLimitService.resolveTier({
        headers: { 'x-api-key': 'partner-premium-key-123' },
      });
      expect(tier).toBe(RateLimitTier.PREMIUM);
      expect(identifier).toBe('key:partner-premium-key-123');
    });

    it('resolves authenticated tier for user session', () => {
      const { tier, identifier } = rateLimitService.resolveTier({
        user: { publicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H' },
      });
      expect(tier).toBe(RateLimitTier.AUTHENTICATED);
      expect(identifier).toBe('user:GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H');
    });

    it('resolves anonymous tier by default', () => {
      const { tier, identifier } = rateLimitService.resolveTier({});
      expect(tier).toBe(RateLimitTier.ANONYMOUS);
      expect(identifier).toBe('anon');
    });
  });

  describe('Sliding Window Rate Limiting', () => {
    it('allows the first request and creates the rate-limit window', async () => {
      mockEval.mockResolvedValueOnce([1, 4, 1, 86400]);

      const result = await rateLimitService.checkRateLimit('user123', SCORE_UPDATE_RATE_LIMIT);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.currentCount).toBe(1);
      expect(mockEval).toHaveBeenCalled();
    });

    it('enforces configured limits for all tiers', () => {
      expect(TIER_LIMITS[RateLimitTier.ANONYMOUS].maxRequests).toBe(30);
      expect(TIER_LIMITS[RateLimitTier.AUTHENTICATED].maxRequests).toBe(100);
      expect(TIER_LIMITS[RateLimitTier.PREMIUM].maxRequests).toBe(1000);
      expect(TIER_LIMITS[RateLimitTier.INTERNAL].maxRequests).toBe(10000);

      expect(EXPENSIVE_OPERATION_LIMITS.SEARCH.maxRequests).toBe(10);
      expect(EXPENSIVE_OPERATION_LIMITS.LOAN_APPLICATION.maxRequests).toBe(5);
    });

    it('blocks requests once the counter exceeds limit', async () => {
      mockEval.mockResolvedValueOnce([0, 0, 5, 60]);

      const result = await rateLimitService.checkRateLimit('user123', {
        maxRequests: 5,
        windowSeconds: 60,
      });

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.currentCount).toBe(5);
    });

    it('falls back to in-memory sliding window when Redis is unavailable', async () => {
      mockEval.mockRejectedValueOnce(new Error('Redis connection failed'));

      const result = await rateLimitService.checkRateLimit('inmem-user', {
        maxRequests: 2,
        windowSeconds: 60,
      });

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it('resets the rate limit counter', async () => {
      await rateLimitService.resetRateLimit('user123');
      expect(mockDel).toHaveBeenCalledWith('rate_limit:user123');
    });

    it('returns current status without incrementing', async () => {
      mockZCard.mockResolvedValueOnce(2);

      const result = await rateLimitService.getRateLimitStatus('user123', SCORE_UPDATE_RATE_LIMIT);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3);
      expect(mockEval).not.toHaveBeenCalled();
    });
  });
});
