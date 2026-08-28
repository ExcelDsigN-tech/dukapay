import jwt from 'jsonwebtoken';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import crypto from 'crypto';
import { resolveRoleForWallet, resolveScopesForRole, type UserRole } from '../auth/rbac.js';
import { cacheService } from './cacheService.js';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/errorCodes.js';
import logger from '../utils/logger.js';

export interface JwtPayload {
  publicKey: string;
  role: UserRole;
  scopes: string[];
  jti: string;
  iat: number;
  exp: number;
  tokenType?: 'access' | 'refresh' | undefined;
  familyId?: string | undefined;
  deviceFingerprint?: string | undefined;
}

export interface ChallengeMessage {
  message: string;
  nonce: string;
  timestamp: number;
  expiresIn: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  publicKey: string;
  familyId: string;
  expiresIn: number; // in seconds (e.g. 900 for 15m)
}

export interface StoredRefreshTokenMetadata {
  jti: string;
  familyId: string;
  publicKey: string;
  isUsed: boolean;
  isRevoked: boolean;
  deviceFingerprint?: string | undefined;
  createdAt: number;
  expiresAt: number;
}

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
export const ACCESS_TOKEN_EXPIRES_IN = '15m';
export const REFRESH_TOKEN_EXPIRES_IN = '7d';
const CHALLENGE_EXPIRES_IN_MS = 5 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 1000;

const REFRESH_TOKEN_PREFIX = 'refresh_token:';
const TOKEN_FAMILY_PREFIX = 'token_family:';
const REVOKED_JTI_PREFIX = 'revoked-jti:';

// In-memory fallback stores when Redis / cache is offline
const inMemoryRefreshTokens = new Map<string, StoredRefreshTokenMetadata>();
const inMemoryRevokedFamilies = new Map<string, { revokedAt: number; reason: string }>();

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
}

export function generateChallenge(publicKey: string): ChallengeMessage {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new Error('Invalid Stellar public key');
  }

  const nonce = crypto.randomBytes(32).toString('hex');
  const timestamp = Date.now();

  const message = `Sign this message to authenticate with DukaPay.\n\nNonce: ${nonce}\nTimestamp: ${timestamp}\n\nThis request will expire in 5 minutes.`;

  return {
    message,
    nonce,
    timestamp,
    expiresIn: CHALLENGE_EXPIRES_IN_MS,
  };
}

export function verifySignature(publicKey: string, message: string, signature: string): boolean {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    return false;
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(signature)) {
    return false;
  }

  try {
    const signatureBytes = Buffer.from(signature, 'base64');
    if (signatureBytes.length !== 64) {
      return false;
    }

    const messageBytes = Buffer.from(message, 'utf-8');

    return Keypair.fromPublicKey(publicKey).verify(messageBytes, signatureBytes);
  } catch {
    return false;
  }
}

export function verifyChallengeTimestamp(
  timestamp: number,
  maxAgeMs: number = CHALLENGE_EXPIRES_IN_MS,
): boolean {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return false;
  }

  const now = Date.now();
  const age = now - timestamp;

  if (age < -CLOCK_SKEW_TOLERANCE_MS) {
    return false;
  }

  return age <= maxAgeMs;
}

export function generateDeviceFingerprint(req: {
  ip?: string | undefined;
  headers?: Record<string, string | string[] | undefined> | undefined;
}): string {
  const userAgent = (req.headers?.['user-agent'] as string) ?? 'unknown';
  const acceptLanguage = (req.headers?.['accept-language'] as string) ?? '';
  const ip = req.ip ?? 'unknown';

  return crypto.createHash('sha256').update(`${ip}:${userAgent}:${acceptLanguage}`).digest('hex');
}

/**
 * Generates an Access Token (15m) for API authentication.
 */
export function generateJwtToken(
  publicKey: string,
  options?: { familyId?: string | undefined; deviceFingerprint?: string | undefined },
): string {
  const secret = getJwtSecret();
  const role = resolveRoleForWallet(publicKey);
  const scopes = resolveScopesForRole(role);

  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    publicKey,
    role,
    scopes,
    jti: crypto.randomUUID(),
    tokenType: 'access',
    familyId: options?.familyId,
    deviceFingerprint: options?.deviceFingerprint,
  };

  return jwt.sign(payload, secret, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    algorithm: 'HS256',
  });
}

/**
 * Generates a Refresh Token (7d) tied to a token family.
 */
export function generateRefreshToken(
  publicKey: string,
  familyId: string,
  deviceFingerprint?: string,
): { refreshToken: string; jti: string } {
  const secret = getJwtSecret();
  const role = resolveRoleForWallet(publicKey);
  const scopes = resolveScopesForRole(role);
  const jti = crypto.randomUUID();

  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    publicKey,
    role,
    scopes,
    jti,
    tokenType: 'refresh',
    familyId,
    deviceFingerprint,
  };

  const refreshToken = jwt.sign(payload, secret, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    algorithm: 'HS256',
  });

  return { refreshToken, jti };
}

/**
 * Issues a new access token (15m) + refresh token (7d) pair.
 */
export async function generateTokenPair(
  publicKey: string,
  deviceFingerprint?: string,
  existingFamilyId?: string,
): Promise<TokenPair> {
  const familyId = existingFamilyId ?? crypto.randomUUID();
  const accessToken = generateJwtToken(publicKey, { familyId, deviceFingerprint });
  const { refreshToken, jti } = generateRefreshToken(publicKey, familyId, deviceFingerprint);

  const now = Date.now();
  const meta: StoredRefreshTokenMetadata = {
    jti,
    familyId,
    publicKey,
    isUsed: false,
    isRevoked: false,
    deviceFingerprint,
    createdAt: now,
    expiresAt: now + REFRESH_TOKEN_TTL_SECONDS * 1000,
  };

  await storeRefreshTokenMetadata(jti, meta);

  return {
    accessToken,
    refreshToken,
    publicKey,
    familyId,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

const CACHE_TIMEOUT_MS = 50;

async function storeRefreshTokenMetadata(
  jti: string,
  meta: StoredRefreshTokenMetadata,
): Promise<void> {
  inMemoryRefreshTokens.set(jti, meta);
  try {
    await Promise.race([
      cacheService.set(`${REFRESH_TOKEN_PREFIX}${jti}`, meta, REFRESH_TOKEN_TTL_SECONDS),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('cache_timeout')), CACHE_TIMEOUT_MS),
      ),
    ]);
  } catch {
    // In-memory fallback is already populated
  }
}

async function getRefreshTokenMetadata(jti: string): Promise<StoredRefreshTokenMetadata | null> {
  try {
    const cached = await Promise.race([
      cacheService.get<StoredRefreshTokenMetadata>(`${REFRESH_TOKEN_PREFIX}${jti}`),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CACHE_TIMEOUT_MS)),
    ]);
    if (cached) return cached;
  } catch {
    // Fall back to in-memory store
  }

  return inMemoryRefreshTokens.get(jti) ?? null;
}

/**
 * Revokes an entire token family when reuse or attack is detected.
 */
export async function revokeTokenFamily(
  familyId: string,
  reason = 'security_revocation',
): Promise<void> {
  const now = Date.now();
  inMemoryRevokedFamilies.set(familyId, { revokedAt: now, reason });

  try {
    await Promise.race([
      cacheService.set(
        `${TOKEN_FAMILY_PREFIX}${familyId}`,
        { isRevoked: true, revokedAt: now, reason },
        REFRESH_TOKEN_TTL_SECONDS,
      ),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('cache_timeout')), CACHE_TIMEOUT_MS),
      ),
    ]);
  } catch {
    // in-memory fallback already recorded
  }

  logger.withContext().warn('Token family revoked', {
    familyId,
    reason,
    revokedAt: new Date(now).toISOString(),
  });
}

/**
 * Checks if a token family has been revoked.
 */
export async function isFamilyRevoked(familyId: string): Promise<boolean> {
  if (inMemoryRevokedFamilies.has(familyId)) {
    return true;
  }

  try {
    const cached = await Promise.race([
      cacheService.get<{ isRevoked: boolean }>(`${TOKEN_FAMILY_PREFIX}${familyId}`),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CACHE_TIMEOUT_MS)),
    ]);
    if (cached?.isRevoked) {
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

/**
 * Rotates a refresh token with replay detection.
 * If an already-used refresh token is presented, revokes the entire family and logs an alert.
 */
export async function rotateRefreshToken(
  oldRefreshToken: string,
  currentDeviceFingerprint?: string,
): Promise<TokenPair> {
  const decoded = verifyJwtToken(oldRefreshToken);
  if (!decoded || decoded.tokenType !== 'refresh' || !decoded.familyId) {
    throw AppError.unauthorized(
      'Invalid or malformed refresh token',
      ErrorCode.INVALID_REFRESH_TOKEN,
    );
  }

  const { familyId, jti, publicKey, deviceFingerprint: storedFingerprint } = decoded;

  // 1. Check if token family is revoked
  if (await isFamilyRevoked(familyId)) {
    logger.withContext().warn('Attempted to refresh with revoked token family', {
      familyId,
      publicKey,
    });
    throw AppError.unauthorized(
      'Session has been revoked. Please sign in again.',
      ErrorCode.UNAUTHORIZED,
    );
  }

  // 2. Fetch stored metadata for this jti
  const meta = await getRefreshTokenMetadata(jti);

  // 3. Replay detection: If token was already used or revoked, revoke entire family!
  if (!meta || meta.isUsed || meta.isRevoked) {
    await revokeTokenFamily(familyId, 'token_replay_detected');
    logger
      .withContext()
      .error('SECURITY ALERT: Refresh token replay detected! Token family revoked.', {
        familyId,
        publicKey,
        replayedJti: jti,
        currentDeviceFingerprint,
        storedFingerprint,
      });

    throw AppError.unauthorized(
      'Refresh token replay detected. All active sessions in this family have been revoked.',
      ErrorCode.TOKEN_REPLAY_DETECTED,
    );
  }

  // 4. Validate device fingerprint (if provided)
  if (
    storedFingerprint &&
    currentDeviceFingerprint &&
    storedFingerprint !== currentDeviceFingerprint
  ) {
    logger.withContext().warn('Device fingerprint mismatch on token refresh', {
      publicKey,
      familyId,
      storedFingerprint,
      currentDeviceFingerprint,
    });
  }

  // 5. Mark current token as used
  meta.isUsed = true;
  await storeRefreshTokenMetadata(jti, meta);

  // 6. Issue new token pair in the same family
  return generateTokenPair(publicKey, currentDeviceFingerprint ?? storedFingerprint, familyId);
}

export function verifyJwtToken(token: string): JwtPayload | null {
  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    }) as JwtPayload;

    return decoded;
  } catch {
    return null;
  }
}

export async function revokeToken(jti: string, exp: number): Promise<void> {
  const ttlSeconds = exp - Math.floor(Date.now() / 1000);
  if (ttlSeconds <= 0) return;

  try {
    await cacheService.set(`${REVOKED_JTI_PREFIX}${jti}`, true, ttlSeconds);
  } catch {
    // In-memory fallback
    inMemoryRefreshTokens.set(jti, {
      jti,
      familyId: 'single',
      publicKey: '',
      isUsed: true,
      isRevoked: true,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }
}

const REVOCATION_CHECK_TIMEOUT_MS = 250;

export async function isTokenRevoked(jti: string): Promise<boolean> {
  try {
    const revoked = await Promise.race([
      cacheService.get<boolean>(`${REVOKED_JTI_PREFIX}${jti}`),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), REVOCATION_CHECK_TIMEOUT_MS)),
    ]);

    return revoked === true;
  } catch {
    return false;
  }
}

export function decodeJwtToken(token: string): JwtPayload | null {
  try {
    return jwt.decode(token) as JwtPayload | null;
  } catch {
    return null;
  }
}

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1] ?? null;
}
