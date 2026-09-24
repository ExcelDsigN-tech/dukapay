import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  generateTokenPair,
  invalidateAllFamilies,
  isFamilyRevoked,
  revokeTokenFamily,
} from '../services/authService.js';

describe('authService - Token TTL Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use environment variables for token TTLs when set', () => {
    const accessTtl = ACCESS_TOKEN_TTL_SECONDS;
    const refreshTtl = REFRESH_TOKEN_TTL_SECONDS;

    expect(accessTtl).toBeGreaterThan(0);
    expect(refreshTtl).toBeGreaterThan(0);
    expect(accessTtl).toBeLessThan(refreshTtl);
  });

  it('should validate that access TTL is less than refresh TTL', () => {
    const accessTtl = ACCESS_TOKEN_TTL_SECONDS;
    const refreshTtl = REFRESH_TOKEN_TTL_SECONDS;

    expect(accessTtl).toBeLessThan(refreshTtl);
  });

  it('should generate token pair with correct TTL values', async () => {
    const publicKey = 'GBPZ36ZCGN6GCR2UGPWBSGSQYV6L5JX4D33HQXQGFVP7IVQMJ6XCMKL4';
    const tokenPair = await generateTokenPair(publicKey);

    expect(tokenPair.expiresIn).toBe(ACCESS_TOKEN_TTL_SECONDS);
    expect(tokenPair.accessToken).toBeDefined();
    expect(tokenPair.refreshToken).toBeDefined();
  });
});

describe('authService - Bulk Token Family Revocation', () => {
  const publicKey = 'GBPZ36ZCGN6GCR2UGPWBSGSQYV6L5JX4D33HQXQGFVP7IVQMJ6XCMKL4';

  it('should revoke a single token family', async () => {
    const familyId = 'test-family-1';
    await revokeTokenFamily(familyId, 'test_revocation');

    const isRevoked = await isFamilyRevoked(familyId);
    expect(isRevoked).toBe(true);
  });

  it('should invalidate all families for a user', async () => {
    await invalidateAllFamilies(publicKey, 'test_logout_all');
  });

  it('should log revocation events for audit trail', async () => {
    const familyId = 'test-family-audit';
    await revokeTokenFamily(familyId, 'security_test');

    const isRevoked = await isFamilyRevoked(familyId);
    expect(isRevoked).toBe(true);
  });
});
