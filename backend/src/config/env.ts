import logger from '../utils/logger.js';

/**
 * List of environment variables required for the application to function.
 * If any of these are missing or empty on startup, the server will exit immediately
 * with a clear error message.
 */
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'STELLAR_RPC_URL',
  'STELLAR_NETWORK_PASSPHRASE',
  'LOAN_MANAGER_CONTRACT_ID',
  'LENDING_POOL_CONTRACT_ID',
  'REMITTANCE_NFT_CONTRACT_ID',
  'MULTISIG_GOVERNANCE_CONTRACT_ID',
  'POOL_TOKEN_ADDRESS',
  'LOAN_MANAGER_ADMIN_SECRET',
  'INTERNAL_API_KEY',
  'FRONTEND_URL',
  'SCORE_DELTA_REPAY',
  'SCORE_DELTA_DEFAULT',
  'SCORE_DELTA_LATE',
];

/**
 * Compliance flags that must be explicitly enabled outside development.
 * KYC defaults to `false` (dev default) — staging/production deploys must
 * set it to `"true"`. AUDIT_ANCHOR is recommended but must not block boot:
 * when it is off in production we log a warning; when it is on, both
 * AUDIT_ANCHOR_CONTRACT_ID and AUDIT_ANCHOR_SOURCE_SECRET are required.
 * Called from {@link validateEnvVars} when `NODE_ENV=production`, and
 * mirrored by `scripts/check-prod-flags.mjs` in CI.
 */
export function validateProductionComplianceFlags(): void {
  if (process.env.NODE_ENV !== 'production') return;

  if (process.env.KYC_ENFORCEMENT_ENABLED !== 'true') {
    console.error(
      `\n\x1b[1;31mFATAL ERROR: Production compliance flags not enabled\x1b[0m\n` +
        `These must be "true" in production: \x1b[1mKYC_ENFORCEMENT_ENABLED\x1b[0m\n` +
        `See docs/ENVIRONMENT.md launch posture.\n`,
    );
    logger.error('Production compliance flags not enabled', {
      off: ['KYC_ENFORCEMENT_ENABLED'],
      node_env: process.env.NODE_ENV,
    });
    process.exit(1);
  }

  if (process.env.AUDIT_ANCHOR_ENABLED !== 'true') {
    const message =
      'AUDIT_ANCHOR_ENABLED is off in production — audit anchoring disabled (recommended: "true")';
    console.warn(
      `\n\x1b[1;33mWARNING: ${message}\x1b[0m\nSee docs/ENVIRONMENT.md launch posture.\n`,
    );
    logger.warn(message, { node_env: process.env.NODE_ENV });
    return;
  }

  const missing = ['AUDIT_ANCHOR_CONTRACT_ID', 'AUDIT_ANCHOR_SOURCE_SECRET'].filter(
    (key) => !process.env[key] || process.env[key]!.trim() === '',
  );
  if (missing.length > 0) {
    console.error(
      `\n\x1b[1;31mFATAL ERROR: Audit anchoring enabled but misconfigured\x1b[0m\n` +
        `AUDIT_ANCHOR_ENABLED is "true" but missing: \x1b[1m${missing.join(', ')}\x1b[0m\n` +
        `Anchoring would silently no-op (see auditMerkleService). Set both or disable anchoring.\n`,
    );
    logger.error('Audit anchoring misconfigured in production', {
      missing,
      node_env: process.env.NODE_ENV,
    });
    process.exit(1);
  }
}

/**
 * Validates that all critical environment variables are set and non-empty.
 * Logs a clear error message and halts the process if any requirements are unmet.
 */
export function validateEnvVars(): void {
  // Filter for variables that are either absent OR just whitespace
  const missing = REQUIRED_ENV_VARS.filter(
    (key) => !process.env[key] || process.env[key]!.trim() === '',
  );

  if (missing.length > 0) {
    const boldRed = (msg: string) => `\x1b[1;31m${msg}\x1b[0m`;
    const bold = (msg: string) => `\x1b[1m${msg}\x1b[0m`;

    const errorPrefix = boldRed('FATAL ERROR: Environment validation failed');
    const missingVarMsg = `Missing or empty required variables: ${bold(missing.join(', '))}`;
    const actionMsg = `Please verify these variables in your \x1b[4m.env\x1b[0m file or deployment environment.`;

    // Direct console error for immediate visibility during startup failure
    console.error(`\n${errorPrefix}\n${missingVarMsg}\n${actionMsg}\n`);

    // Structured log for persistent logs (e.g., Sentry, CloudWatch, etc.)
    logger.error('Environment validation failure', {
      missing,
      node_env: process.env.NODE_ENV,
    });

    // Stop execution immediately
    process.exit(1);
  }

  logger.info('Environment variables validated successfully.');

  validateProductionComplianceFlags();
}
