import type { Request, Response } from 'express';
import { query } from '../db/connection.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AppError } from '../errors/AppError.js';
import { cacheService } from '../services/cacheService.js';
import { sorobanService } from '../services/sorobanService.js';
import { jobMetricsService } from '../services/jobMetricsService.js';
import { crossContractReconciler } from '../services/crossContractReconciler.js';
import { type UserRole } from '../auth/rbac.js';
import logger from '../utils/logger.js';

interface UserRow {
  id: number;
  public_key: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  email_enabled: boolean | null;
  sms_enabled: boolean | null;
  created_at: Date | string;
  updated_at: Date | string;
  metadata: Record<string, unknown> | null;
}

interface AdminUserRow {
  public_key: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  metadata: Record<string, unknown> | null;
  last_login_at: Date | string | null;
  role: string | null;
  is_suspended: boolean | null;
  kyc_verified: boolean | null;
  loan_count: number | string;
  total_principal: string | null;
  failed_login_attempts: number | null;
}

function serializeAdminUser(row: AdminUserRow) {
  const metadata =
    typeof row.metadata === 'object' && row.metadata !== null
      ? (row.metadata as Record<string, unknown>)
      : {};

  return {
    id: String(row.public_key),
    publicKey: row.public_key,
    displayName: row.display_name ?? '',
    email: row.email ?? '',
    role: (row.role ?? 'borrower') as UserRole,
    isSuspended: Boolean(row.is_suspended),
    kycVerified: Boolean(
      row.kyc_verified ?? metadata.kycVerified ?? metadata.kyc_verified ?? false,
    ),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    lastLoginAt: row.last_login_at
      ? row.last_login_at instanceof Date
        ? row.last_login_at.toISOString()
        : new Date(row.last_login_at).toISOString()
      : null,
    stats: {
      loanCount: Number(row.loan_count ?? 0),
      totalPrincipal: row.total_principal ?? '0',
    },
  };
}

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const roleFilter = typeof req.query.role === 'string' ? req.query.role : undefined;
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const offset = Number(req.query.offset ?? 0);

  const params: unknown[] = [];
  const conditions: string[] = [];

  if (roleFilter) {
    params.push(roleFilter);
    conditions.push(`(up.metadata->>'role') = $${params.length}`);
  }

  if (statusFilter === 'suspended') {
    params.push(true);
    conditions.push(`(up.metadata->>'is_suspended')::boolean = $${params.length}`);
  } else if (statusFilter === 'active') {
    params.push(false);
    conditions.push(
      `((up.metadata->>'is_suspended')::boolean IS NULL OR (up.metadata->>'is_suspended')::boolean = $${params.length})`,
    );
  }

  if (search) {
    params.push(`%${search}%`);
    const searchParam = `$${params.length}`;
    conditions.push(
      `(up.display_name ILIKE ${searchParam} OR up.email ILIKE ${searchParam} OR up.public_key ILIKE ${searchParam})`,
    );
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await query(
    `SELECT
       up.public_key,
       up.display_name,
       up.email,
       up.created_at,
       up.metadata,
       u.last_login_at,
       COUNT(l.id) AS loan_count,
       COALESCE(SUM(l.principal), '0') AS total_principal
     FROM user_profiles up
     LEFT JOIN auth_users u ON u.public_key = up.public_key
     LEFT JOIN loans l ON l.borrower_public_key = up.public_key
     ${whereClause}
     GROUP BY up.public_key, up.display_name, up.email, up.created_at, up.metadata, u.last_login_at
     ORDER BY up.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  const rows: AdminUserRow[] = result.rows.map((row) => row as unknown as AdminUserRow);

  res.json({
    users: rows.map(serializeAdminUser),
    limit,
    offset,
    count: rows.length,
  });
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const publicKey = req.params.publicKey;
  if (!publicKey) {
    throw AppError.badRequest('publicKey parameter is required');
  }

  const result = await query(
    `SELECT
       up.public_key,
       up.display_name,
       up.email,
       up.phone,
       up.created_at,
       up.updated_at,
       up.metadata,
       u.last_login_at,
       u.failed_login_attempts
     FROM user_profiles up
     LEFT JOIN auth_users u ON u.public_key = up.public_key
     WHERE up.public_key = $1`,
    [publicKey],
  );

  const row = result.rows[0] as AdminUserRow | undefined;
  if (!row) {
    throw AppError.notFound('User not found');
  }

  const metadata =
    typeof row.metadata === 'object' && row.metadata !== null
      ? (row.metadata as Record<string, unknown>)
      : {};

  const roles: UserRole[] = ['borrower'];
  if (metadata.role && typeof metadata.role === 'string') {
    const roleStr = metadata.role as string;
    const validRoles: UserRole[] = ['admin', 'super_admin', 'ops', 'support', 'borrower', 'lender'];
    if (validRoles.includes(roleStr as UserRole)) {
      roles.unshift(roleStr as UserRole);
    }
  }

  res.json({
    id: row.public_key,
    publicKey: row.public_key,
    displayName: row.display_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    role: metadata.role ?? 'borrower',
    roles,
    isSuspended: Boolean(metadata.is_suspended ?? false),
    kycVerified: Boolean(metadata.kycVerified ?? metadata.kyc_verified ?? false),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString(),
    lastLoginAt: row.last_login_at
      ? row.last_login_at instanceof Date
        ? row.last_login_at.toISOString()
        : new Date(row.last_login_at).toISOString()
      : null,
    failedLoginAttempts: Number(row.failed_login_attempts ?? 0),
  });
});

export const updateUserStatus = asyncHandler(async (req: Request, res: Response) => {
  const publicKey = req.params.publicKey;
  const { isSuspended } = req.body as { isSuspended: boolean };

  if (!publicKey) {
    throw AppError.badRequest('publicKey parameter is required');
  }

  const profile = await query('SELECT metadata FROM user_profiles WHERE public_key = $1', [
    publicKey,
  ]);
  if (profile.rows.length === 0) {
    throw AppError.notFound('User not found');
  }

  const currentMetadata = (profile.rows[0] as UserRow).metadata ?? {};
  const updatedMetadata = { ...currentMetadata, is_suspended: isSuspended };

  await query(
    'UPDATE user_profiles SET metadata = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE public_key = $2',
    [JSON.stringify(updatedMetadata), publicKey],
  );

  logger.withContext().info('User status updated', {
    publicKey,
    isSuspended,
    actor: req.user?.publicKey,
  });

  res.json({ success: true, publicKey, isSuspended });
});

export const updateUserRole = asyncHandler(async (req: Request, res: Response) => {
  const publicKey = req.params.publicKey;
  const { role } = req.body as { role: string };

  if (!publicKey) {
    throw AppError.badRequest('publicKey parameter is required');
  }

  const validRoles: UserRole[] = ['admin', 'super_admin', 'ops', 'support', 'borrower', 'lender'];
  if (!validRoles.includes(role as UserRole)) {
    throw AppError.badRequest(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
  }

  const profile = await query('SELECT metadata FROM user_profiles WHERE public_key = $1', [
    publicKey,
  ]);
  if (profile.rows.length === 0) {
    throw AppError.notFound('User not found');
  }

  const currentMetadata = (profile.rows[0] as UserRow).metadata ?? {};
  const updatedMetadata = { ...currentMetadata, role: role };

  await query(
    'UPDATE user_profiles SET metadata = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE public_key = $2',
    [JSON.stringify(updatedMetadata), publicKey],
  );

  logger.withContext().info('User role updated', {
    publicKey,
    role,
    actor: req.user?.publicKey,
  });

  res.json({ success: true, publicKey, role });
});

export const overrideKycStatus = asyncHandler(async (req: Request, res: Response) => {
  const { publicKey, verified, level } = req.body as {
    publicKey: string;
    verified: boolean;
    level?: string;
  };

  if (!publicKey) {
    throw AppError.badRequest('publicKey is required');
  }

  const profile = await query('SELECT metadata FROM user_profiles WHERE public_key = $1', [
    publicKey,
  ]);
  if (profile.rows.length === 0) {
    throw AppError.notFound('User not found');
  }

  const currentMetadata = (profile.rows[0] as UserRow).metadata ?? {};
  const updatedMetadata = {
    ...currentMetadata,
    kycVerified: verified,
    kyc_verified: verified,
    kyc_level: level ?? (verified ? 'basic' : 'none'),
    kyc_override: true,
    kyc_override_by: req.user?.publicKey,
    kyc_override_at: new Date().toISOString(),
  };

  await query(
    'UPDATE user_profiles SET metadata = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE public_key = $2',
    [JSON.stringify(updatedMetadata), publicKey],
  );

  logger.withContext().info('KYC status overridden', {
    publicKey,
    verified,
    level: level ?? 'basic',
    actor: req.user?.publicKey,
  });

  res.json({ success: true, publicKey, verified, level: level ?? 'basic' });
});

export const getSystemHealth = asyncHandler(async (_req: Request, res: Response) => {
  const checks: Array<{ name: string; status: 'ok' | 'degraded' | 'down'; detail?: string }> = [];

  // Database connectivity
  try {
    const dbStart = Date.now();
    await query('SELECT 1');
    const dbLatency = Date.now() - dbStart;
    const entry: { name: string; status: 'ok' | 'degraded' | 'down'; detail?: string } = {
      name: 'database',
      status: dbLatency < 500 ? 'ok' : 'degraded',
      detail: `${dbLatency}ms`,
    };
    checks.push(entry);
  } catch (error) {
    checks.push({
      name: 'database',
      status: 'down',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // Redis connectivity
  try {
    const redisStart = Date.now();
    await cacheService.get<string>('health:redis:ping');
    const redisLatency = Date.now() - redisStart;
    checks.push({
      name: 'redis',
      status: redisLatency < 200 ? 'ok' : 'degraded',
      detail: `${redisLatency}ms`,
    });
  } catch (error) {
    checks.push({
      name: 'redis',
      status: 'down',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // Stellar RPC
  try {
    const rpcResult = await sorobanService.healthCheck();
    const detail =
      rpcResult.error ?? (rpcResult.latestLedger ? `ledger ${rpcResult.latestLedger}` : undefined);
    checks.push({
      name: 'stellar_rpc',
      status: rpcResult.connected ? 'ok' : 'down',
      ...(detail !== undefined ? { detail } : {}),
    });
  } catch {
    checks.push({ name: 'stellar_rpc', status: 'down' });
  }

  // Job metrics snapshot
  const jobMetrics = jobMetricsService.getAllMetrics();

  const overallStatus = checks.every((c) => c.status === 'ok')
    ? 'ok'
    : checks.some((c) => c.status === 'down')
      ? 'down'
      : 'degraded';

  res.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    checks,
    jobs: jobMetrics,
  });
});

export const triggerBatchSettlement = asyncHandler(async (req: Request, res: Response) => {
  const { loanIds, force } = req.body as { loanIds?: number[]; force?: boolean };

  const result = await crossContractReconciler.run();

  res.json({
    success: true,
    message: 'Batch settlement run triggered',
    details: result,
    loanIds: loanIds ?? null,
    force: Boolean(force),
  });
});

interface FeatureFlagRow {
  id: number;
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  value: string | null;
  scope: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export const listFeatureFlags = asyncHandler(async (_req: Request, res: Response) => {
  const result = await query(
    `SELECT id, key, name, description, enabled, value, scope, created_at, updated_at
     FROM feature_flags
     ORDER BY key ASC`,
  );

  const flags: FeatureFlagRow[] = result.rows.map((row) => row as unknown as FeatureFlagRow);

  res.json({ flags });
});

export const updateFeatureFlag = asyncHandler(async (req: Request, res: Response) => {
  const key = req.params.key;
  const { enabled, value } = req.body as { enabled?: boolean; value?: string };

  if (!key) {
    throw AppError.badRequest('key parameter is required');
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (enabled !== undefined) {
    updates.push(`enabled = $${paramIndex++}`);
    values.push(enabled);
  }

  if (value !== undefined) {
    updates.push(`value = $${paramIndex++}::jsonb`);
    values.push(value);
  }

  if (updates.length === 0) {
    throw AppError.badRequest('At least one of "enabled" or "value" must be provided');
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(key);

  const result = await query(
    `UPDATE feature_flags SET ${updates.join(', ')} WHERE key = $${paramIndex} RETURNING *`,
    values,
  );

  if (result.rows.length === 0) {
    throw AppError.notFound('Feature flag not found');
  }

  const flag = result.rows[0] as FeatureFlagRow;

  await cacheService.delete(`feature_flag:${key}`);

  logger.withContext().info('Feature flag updated', {
    key,
    enabled: flag.enabled,
    actor: req.user?.publicKey,
  });

  res.json({
    success: true,
    flag: {
      key: flag.key,
      name: flag.name,
      enabled: flag.enabled,
      value: flag.value,
      scope: flag.scope,
    },
  });
});
