import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export const createRateLimiter = (max: number, windowMinutes: number = 15) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

export const globalRateLimiter = createRateLimiter(100);
export const strictRateLimiter = createRateLimiter(10, 45);

// Auth endpoints: 10 req/min per IP (stricter rate limiting for brute-force protection)
export const challengeRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  message: {
    success: false,
    message: 'Too many challenge requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
    res.status(429).json(options.message);
  },
});

export const loginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip ?? 'unknown')}:${req.body?.publicKey ?? 'unknown'}`,
  message: {
    success: false,
    message: 'Too many login attempts, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
    res.status(429).json(options.message);
  },
});

export const ipLoginRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  message: {
    success: false,
    message: 'Too many login attempts from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
    res.status(429).json(options.message);
  },
});

export const verifyRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  message: { success: false, message: 'Too many verification attempts' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res, _next, options) => {
    res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
    res.status(429).json(options.message);
  },
});

// Simulation endpoints: 5 req/min per authenticated user
export const simulationRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  keyGenerator: (req) => {
    // Use authenticated user's public key if available, otherwise fall back to IP
    const user = (req as unknown as { user?: { publicKey: string } }).user;
    return user?.publicKey ?? ipKeyGenerator(req.ip ?? 'unknown');
  },
  message: {
    success: false,
    message: 'Too many simulation requests, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (_req, res, _next, options) => {
    res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
    res.status(429).json(options.message);
  },
});

/**
 * Identity a request is limited under: the authenticated wallet when there is
 * one (so one user cannot dodge the limit by rotating IPs, and users behind a
 * shared NAT do not throttle each other), otherwise the client IP.
 *
 * Mount user-keyed limiters AFTER the JWT middleware so `req.user` is set.
 */
export const userOrIpKey = (req: {
  user?: { publicKey?: string } | undefined;
  ip?: string | undefined;
}): string => {
  const publicKey = req.user?.publicKey;
  return publicKey ? `user:${publicKey}` : `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
};

interface ReadLimiterOptions {
  /** Requests allowed per window, per identity. */
  max: number;
  /** Message returned with the 429. */
  message: string;
  /** Window length; defaults to one minute. */
  windowMs?: number;
}

/**
 * Per-identity limiter for read endpoints that are sensitive to enumeration or
 * scraping. Each call returns an independent counter, so a busy endpoint cannot
 * exhaust the budget of another. Not skipped under test: enforcement is part
 * of the contract these limiters make.
 */
const createReadRateLimiter = ({ max, message, windowMs = 60 * 1000 }: ReadLimiterOptions) =>
  rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => userOrIpKey(req as Parameters<typeof userOrIpKey>[0]),
    message: { success: false, message },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      res.setHeader('Retry-After', Math.ceil(options.windowMs / 1000));
      res.status(429).json(options.message);
    },
  });

/** Admin audit log listing: the most sensitive read, so the tightest limit (30/min per admin). */
export const auditLogsRateLimiter = createReadRateLimiter({
  max: 30,
  message: 'Too many audit log requests, please try again later.',
});

/** Admin dispute list and detail reads (60/min per admin). */
export const adminDisputesRateLimiter = createReadRateLimiter({
  max: 60,
  message: 'Too many dispute requests, please try again later.',
});

/** Admin pending-governance listing (60/min per admin). */
export const governancePendingRateLimiter = createReadRateLimiter({
  max: 60,
  message: 'Too many governance requests, please try again later.',
});

/** Public pool analytics (60/min per IP). */
export const poolAnalyticsRateLimiter = createReadRateLimiter({
  max: 60,
  message: 'Too many analytics requests, please try again later.',
});

/** Credit score reads: per wallet when authenticated, per IP for the public leaderboard (60/min). */
export const scoreReadRateLimiter = createReadRateLimiter({
  max: 60,
  message: 'Too many score requests, please try again later.',
});
