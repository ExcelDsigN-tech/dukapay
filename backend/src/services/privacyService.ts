import crypto from 'node:crypto';
import { pool } from '../db/connection.js';
import { query, withTransaction } from '../db/connection.js';
import logger from '../utils/logger.js';

const ANONYMIZATION_HASH_SALT = process.env.ANONYMIZATION_HASH_SALT ?? 'dukapay-anon-default';

export interface DsarRequest {
  id: string;
  publicKey: string;
  type: 'access' | 'deletion' | 'anonymization';
  status: 'pending' | 'processing' | 'completed' | 'rejected';
  reason: string;
  createdAt: string;
  completedAt?: string;
}

export interface UserDataExport {
  profile: Record<string, unknown> | null;
  scores: Record<string, unknown>[];
  loanEvents: Record<string, unknown>[];
  remittances: Record<string, unknown>[];
  auditLogs: Record<string, unknown>[];
  notificationEvents: Record<string, unknown>[];
}

/**
 * Generate a consistent anonymized hash for a public key.
 * Uses SHA-256 with a salt to prevent rainbow table attacks.
 */
function anonymizePublicKey(publicKey: string): string {
  return crypto
    .createHash('sha256')
    .update(`${ANONYMIZATION_HASH_SALT}:${publicKey}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Anonymize PII fields in a string value.
 * Replaces with a consistent hash so the same input always produces the same output.
 */
function anonymizePiiField(value: string | null): string | null {
  if (!value) return null;
  return 'ANON_' + crypto
    .createHash('sha256')
    .update(`${ANONYMIZATION_HASH_SALT}:${value}`)
    .digest('hex')
    .slice(0, 12);
}

export class PrivacyService {
  /**
   * Create a DSAR (Data Subject Access Request) entry.
   */
  async createDsarRequest(
    publicKey: string,
    type: DsarRequest['type'],
    reason: string,
  ): Promise<DsarRequest> {
    const result = await query(
      `INSERT INTO dsar_requests (id, public_key, type, status, reason, created_at)
       VALUES (gen_random_uuid(), $1, $2, 'pending', $3, NOW())
       RETURNING *`,
      [publicKey, type, reason],
    );

    const row = result.rows[0];
    logger.withContext().info('DSAR request created', {
      dsarId: row.id,
      type,
      publicKey: publicKey.slice(0, 8) + '...',
    });

    return {
      id: row.id,
      publicKey: row.public_key,
      type: row.type,
      status: row.status,
      reason: row.reason,
      createdAt: row.created_at,
    };
  }

  /**
   * Export all user data for a DSAR access request.
   * Returns all PII and associated records without modification.
   */
  async exportUserData(publicKey: string): Promise<UserDataExport> {
    const [profileResult, scoresResult, loanEventsResult, remittancesResult, auditResult, notificationsResult] =
      await Promise.all([
        query('SELECT * FROM user_profiles WHERE public_key = $1', [publicKey]),
        query('SELECT * FROM scores WHERE user_id = $1', [publicKey]),
        query(
          `SELECT * FROM contract_events WHERE address = $1 ORDER BY ledger_closed_at DESC LIMIT 1000`,
          [publicKey],
        ),
        query(
          `SELECT * FROM remittances WHERE sender_id = $1 ORDER BY created_at DESC LIMIT 1000`,
          [publicKey],
        ),
        query(
          `SELECT * FROM audit_logs WHERE actor = $1 ORDER BY created_at DESC LIMIT 500`,
          [publicKey],
        ),
        query(
          `SELECT ne.* FROM notification_events ne
           JOIN user_notification_preferences unp ON ne.user_id = unp.user_id
           WHERE unp.user_id = $1
           ORDER BY ne.created_at DESC LIMIT 500`,
          [publicKey],
        ),
      ]);

    return {
      profile: profileResult.rows[0] ?? null,
      scores: scoresResult.rows,
      loanEvents: loanEventsResult.rows,
      remittances: remittancesResult.rows,
      auditLogs: auditResult.rows,
      notificationEvents: notificationsResult.rows,
    };
  }

  /**
   * Selective PII deletion: removes PII fields while preserving financial records.
   * Hashes PII in financial tables so records remain queryable for accounting
   * but cannot be linked back to the individual.
   */
  async deleteUserData(publicKey: string): Promise<{ deleted: boolean; recordsAnonymized: number }> {
    return withTransaction(async (client) => {
      // 1. Anonymize PII in financial records (preserves record integrity)
      const remittancesResult = await client.query(
        `UPDATE remittances
         SET memo = 'DELETED_USER',
             error_message = NULL
         WHERE sender_id = $1
         RETURNING id`,
        [publicKey],
      );

      // 2. Anonymize contract event addresses
      const anonKey = anonymizePublicKey(publicKey);
      await client.query(
        `UPDATE contract_events
         SET address = $1
         WHERE address = $2`,
        [anonKey, publicKey],
      );

      // 3. Delete PII from user_profiles (replace with anonymized stub)
      await client.query(
        `UPDATE user_profiles
         SET display_name = 'Deleted User',
             email = NULL,
             phone = NULL,
             metadata = '{}'::jsonb,
             updated_at = NOW()
         WHERE public_key = $1`,
        [publicKey],
      );

      // 4. Delete scores (credit scores are personal data)
      await client.query('DELETE FROM scores WHERE user_id = $1', [publicKey]);

      // 5. Delete audit logs referencing this user as actor
      // Financial audit records are held under the seven-year statutory
      // retention policy and are intentionally excluded from erasure.
      await client.query(
        `INSERT INTO audit_logs (actor, action, target, payload, ip_address, status)
         VALUES ('SYSTEM', 'DSAR_RETENTION_HOLD', 'retained-audit-subject',
                 jsonb_build_object('legalBasis', 'financial-record-retention'), NULL, 200)`,
      );

      // 6. Delete PII access logs
      await client.query(
        `DELETE FROM pii_access_log WHERE record_id = $1`,
        [publicKey],
      );

      // 7. Delete notification preferences
      await client.query(
        `DELETE FROM user_notification_preferences WHERE user_id = $1`,
        [publicKey],
      );

      logger.withContext().info('User data deleted (DSAR)', {
        publicKey: publicKey.slice(0, 8) + '...',
        recordsAnonymized: remittancesResult.rowCount ?? 0,
      });

      return {
        deleted: true,
        recordsAnonymized: remittancesResult.rowCount ?? 0,
      };
    });
  }

  /**
   * Anonymize user data for analytics: replaces PII with consistent hashes
   * while preserving behavioral patterns for aggregate analytics.
   */
  async anonymizeUserData(publicKey: string): Promise<{ anonymized: boolean }> {
    return withTransaction(async (client) => {
      const anonKey = anonymizePublicKey(publicKey);

      // Anonymize profile
      await client.query(
        `UPDATE user_profiles
         SET display_name = $1,
             email = NULL,
             phone = NULL,
             metadata = jsonb_set(
               COALESCE(metadata, '{}'::jsonb),
               '{anonymized}',
               'true'::jsonb
             ),
             updated_at = NOW()
         WHERE public_key = $2`,
        [anonymizePiiField(publicKey), publicKey],
      );

      // Anonymize contract events
      await client.query(
        `UPDATE contract_events SET address = $1 WHERE address = $2`,
        [anonKey, publicKey],
      );

      // Anonymize remittances
      await client.query(
        `UPDATE remittances
         SET memo = 'ANONYMIZED'
         WHERE sender_id = $1`,
        [publicKey],
      );

      logger.withContext().info('User data anonymized for analytics', {
        publicKey: publicKey.slice(0, 8) + '...',
      });

      return { anonymized: true };
    });
  }

  /**
   * Get DSAR request status.
   */
  async getDsarRequest(id: string): Promise<DsarRequest | null> {
    const result = await query('SELECT * FROM dsar_requests WHERE id = $1', [id]);
    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      publicKey: row.public_key,
      type: row.type,
      status: row.status,
      reason: row.reason,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  /**
   * Get all pending DSAR requests (admin).
   */
  async getPendingDsars(): Promise<DsarRequest[]> {
    const result = await query(
      "SELECT * FROM dsar_requests WHERE status = 'pending' ORDER BY created_at ASC",
    );

    return result.rows.map((row) => ({
      id: row.id,
      publicKey: row.public_key,
      type: row.type,
      status: row.status,
      reason: row.reason,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }));
  }
}

export const privacyService = new PrivacyService();
