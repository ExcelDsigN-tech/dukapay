import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError.js';
import { ErrorCode } from '../errors/errorCodes.js';

export const CSRF_COOKIE_NAME = process.env.CSRF_COOKIE_NAME ?? 'XSRF-TOKEN';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Default routes exempted from CSRF (e.g. public webhook callbacks with HMAC verification, public challenge)
const DEFAULT_EXEMPT_PATHS = [
  '/api/auth/challenge',
  '/api/v1/auth/challenge',
  '/api/auth/login',
  '/api/v1/auth/login',
  '/api/v1/webhooks',
  '/health',
  '/metrics',
  '/version',
];

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.split('=');
    const trimmedName = name?.trim();
    if (trimmedName) {
      cookies[trimmedName] = decodeURIComponent(rest.join('=').trim());
    }
  });
  return cookies;
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function setCsrfCookie(res: Response, token: string): void {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // Accessible by frontend JavaScript to include in X-CSRF-Token header
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  });
}

export interface CsrfOptions {
  exemptPaths?: string[];
  cookieName?: string;
  headerName?: string;
}

/**
 * Express middleware implementing the Double-Submit Cookie Pattern with SameSite=Strict.
 * Validates CSRF tokens on all mutating HTTP requests (POST, PUT, PATCH, DELETE).
 */
export function csrfProtection(options: CsrfOptions = {}) {
  const exemptPaths = options.exemptPaths ?? DEFAULT_EXEMPT_PATHS;
  const cookieName = options.cookieName ?? CSRF_COOKIE_NAME;

  return (req: Request, res: Response, next: NextFunction) => {
    const cookies =
      (req as unknown as { cookies?: Record<string, string> }).cookies ??
      parseCookies(req.headers.cookie);

    let csrfCookie = cookies[cookieName];

    // Ensure a CSRF token cookie is present for the client session
    if (!csrfCookie) {
      csrfCookie = generateCsrfToken();
      setCsrfCookie(res, csrfCookie);
    }

    // Attach csrfToken helper to response locals
    res.locals.csrfToken = csrfCookie;

    // Safe HTTP methods (GET, HEAD, OPTIONS) do not require CSRF token validation
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      return next();
    }

    // Check if the current path is exempted
    const path = req.path;
    const isExempt = exemptPaths.some((exemptPath) => path.startsWith(exemptPath));
    if (isExempt) {
      return next();
    }

    // Extract CSRF token from header or request body
    const headerToken =
      (req.headers[CSRF_HEADER_NAME] as string | undefined) ??
      (req.headers['x-xsrf-token'] as string | undefined);
    const bodyToken = (req.body as { _csrf?: string } | undefined)?._csrf;
    const submittedToken = headerToken ?? bodyToken;

    if (!submittedToken || typeof submittedToken !== 'string') {
      throw AppError.forbidden(
        'Missing CSRF token in state-changing request',
        ErrorCode.CSRF_TOKEN_INVALID,
      );
    }

    // Validate token equality using constant-time comparison
    const submittedBuffer = Buffer.from(submittedToken, 'utf-8');
    const cookieBuffer = Buffer.from(csrfCookie, 'utf-8');

    if (
      submittedBuffer.length !== cookieBuffer.length ||
      !crypto.timingSafeEqual(submittedBuffer, cookieBuffer)
    ) {
      throw AppError.forbidden(
        'Invalid CSRF token for state-changing request',
        ErrorCode.CSRF_TOKEN_INVALID,
      );
    }

    next();
  };
}

/**
 * Controller endpoint to retrieve or refresh a CSRF token.
 * GET /api/v1/auth/csrf
 */
export function getCsrfTokenController(req: Request, res: Response): void {
  const cookies =
    (req as unknown as { cookies?: Record<string, string> }).cookies ??
    parseCookies(req.headers.cookie);

  let token = cookies[CSRF_COOKIE_NAME];
  if (!token) {
    token = generateCsrfToken();
  }

  setCsrfCookie(res, token);

  res.status(200).json({
    success: true,
    data: {
      csrfToken: token,
    },
  });
}
