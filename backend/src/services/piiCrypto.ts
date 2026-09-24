import crypto from 'node:crypto';
import { pool } from '../db/connection.js';
import logger from '../utils/logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const DEK_LENGTH = 32;
const DEFAULT_KEY_VERSION = 1;
const DEFAULT_DEK_ROTATION_DAYS = 90;

export interface EncryptedField {
  ciphertext: Buffer;
  gcm_nonce: Buffer;
  dek_wrapped: Buffer;
  dek_kek_id: string;
  key_version?: number | undefined;
  created_at?: string | undefined;
  algorithm?: string | undefined;
}

export interface KeyRotationAlert {
  kekId: string;
  keyVersion: number;
  rotatedAt: string;
  reason: string;
  affectedRecords?: number | undefined;
}

export type KeyRotationListener = (alert: KeyRotationAlert) => void | Promise<void>;
const rotationListeners: KeyRotationListener[] = [];

export function onKeyRotationAlert(listener: KeyRotationListener): () => void {
  rotationListeners.push(listener);
  return () => {
    const idx = rotationListeners.indexOf(listener);
    if (idx >= 0) rotationListeners.splice(idx, 1);
  };
}

function getKekId(): string {
  return process.env.PII_KEK_ID ?? 'default-kek';
}

function getKmsEndpoint(): string {
  return process.env.PII_KMS_ENDPOINT ?? '';
}

function getKekKey(): Buffer {
  const hex = process.env.PII_KEK_KEY ?? '0'.repeat(64);
  return Buffer.from(hex, 'hex');
}

async function unwrapDek(dekWrapped: Buffer, kekId: string): Promise<Buffer> {
  const kmsEndpoint = getKmsEndpoint();
  if (kmsEndpoint) {
    const resp = await fetch(`${kmsEndpoint}/decrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kek_id: kekId, wrapped_key: dekWrapped.toString('base64') }),
    });
    if (!resp.ok) throw new Error(`KMS unwrap failed: ${resp.status}`);
    const { plaintext } = (await resp.json()) as { plaintext: string };
    return Buffer.from(plaintext, 'base64');
  }

  const kek = getKekKey();
  const iv = dekWrapped.subarray(0, 12);
  const tag = dekWrapped.subarray(12, 28);
  const data = dekWrapped.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted;
}

async function wrapDek(dek: Buffer, kekId?: string): Promise<Buffer> {
  const targetKekId = kekId ?? getKekId();
  const kmsEndpoint = getKmsEndpoint();
  if (kmsEndpoint) {
    const resp = await fetch(`${kmsEndpoint}/encrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kek_id: targetKekId, plaintext: dek.toString('base64') }),
    });
    if (!resp.ok) throw new Error(`KMS wrap failed: ${resp.status}`);
    const { wrapped_key } = (await resp.json()) as { wrapped_key: string };
    return Buffer.from(wrapped_key, 'base64');
  }

  const kek = getKekKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

/**
 * Encrypts a plaintext PII string using envelope encryption (AES-256-GCM DEK wrapped by KEK).
 */
export async function encryptField(
  plaintext: string,
  options?: { kekId?: string | undefined; keyVersion?: number | undefined },
): Promise<EncryptedField> {
  const kekId = options?.kekId ?? getKekId();
  const keyVersion = options?.keyVersion ?? DEFAULT_KEY_VERSION;
  const dek = crypto.randomBytes(DEK_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([encrypted, tag]);
  const dekWrapped = await wrapDek(dek, kekId);

  return {
    ciphertext,
    gcm_nonce: iv,
    dek_wrapped: dekWrapped,
    dek_kek_id: kekId,
    key_version: keyVersion,
    created_at: new Date().toISOString(),
    algorithm: ALGORITHM,
  };
}

/**
 * Decrypts an envelope-encrypted PII field and logs the access audit trail.
 */
export async function decryptField(
  recordId: string,
  field: string,
  ciphertext: Buffer,
  gcmNonce: Buffer,
  dekWrapped: Buffer,
  dekKekId: string,
  actor: string,
  reason: string,
  requestId: string,
): Promise<string> {
  const dek = await unwrapDek(dekWrapped, dekKekId);
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const encryptedData = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, dek, gcmNonce);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);

  await logPiiAccess(recordId, field, actor, reason, requestId);

  return decrypted.toString('utf8');
}

/**
 * Checks if a DEK was created longer ago than the allowed rotation period (default 90 days).
 */
export function isDekExpired(
  createdAt: string | Date | number | undefined,
  maxAgeDays: number = DEFAULT_DEK_ROTATION_DAYS,
): boolean {
  if (!createdAt) return false;
  const createdTime = typeof createdAt === 'number' ? createdAt : new Date(createdAt).getTime();
  if (!Number.isFinite(createdTime)) return false;
  const ageMs = Date.now() - createdTime;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return ageMs >= maxAgeMs;
}

/**
 * Re-encrypts an existing encrypted field with a fresh DEK and/or updated KEK / key version.
 */
export async function reencryptField(
  recordId: string,
  field: string,
  encrypted: EncryptedField,
  actor: string,
  reason: string,
  requestId: string,
  newKekId?: string,
  newKeyVersion?: number,
): Promise<EncryptedField> {
  const plaintext = await decryptField(
    recordId,
    field,
    encrypted.ciphertext,
    encrypted.gcm_nonce,
    encrypted.dek_wrapped,
    encrypted.dek_kek_id,
    actor,
    reason,
    requestId,
  );

  const reencrypted = await encryptField(plaintext, {
    kekId: newKekId ?? getKekId(),
    keyVersion: newKeyVersion ?? (encrypted.key_version ? encrypted.key_version + 1 : 2),
  });

  await logKeyRotationAlert({
    kekId: reencrypted.dek_kek_id,
    keyVersion: reencrypted.key_version ?? 1,
    rotatedAt: new Date().toISOString(),
    reason: `DEK/KEK rotation for record ${recordId} field ${field}: ${reason}`,
    affectedRecords: 1,
  });

  return reencrypted;
}

/**
 * Serializes an EncryptedField into a portable versioned string token.
 */
export function serializeEncryptedField(field: EncryptedField): string {
  const version = field.key_version ?? DEFAULT_KEY_VERSION;
  const kekId = field.dek_kek_id || 'default-kek';
  const nonceHex = field.gcm_nonce.toString('hex');
  const wrappedHex = field.dek_wrapped.toString('hex');
  const cipherHex = field.ciphertext.toString('hex');
  const createdAt = field.created_at ?? new Date().toISOString();

  return `pii:v${version}:${kekId}:${nonceHex}:${wrappedHex}:${cipherHex}:${Buffer.from(createdAt).toString('hex')}`;
}

/**
 * Deserializes an encrypted string token back into an EncryptedField struct.
 */
export function deserializeEncryptedField(payload: string): EncryptedField {
  if (!payload.startsWith('pii:v')) {
    throw new Error('Invalid encrypted PII payload format');
  }

  const parts = payload.split(':');
  if (parts.length < 6) {
    throw new Error('Malformed encrypted PII payload');
  }

  const version = parseInt(parts[1]!.replace('v', ''), 10);
  const kekId = parts[2]!;
  const nonce = Buffer.from(parts[3]!, 'hex');
  const wrapped = Buffer.from(parts[4]!, 'hex');
  const ciphertext = Buffer.from(parts[5]!, 'hex');
  const createdAt = parts[6] ? Buffer.from(parts[6]!, 'hex').toString('utf8') : undefined;

  return {
    ciphertext,
    gcm_nonce: nonce,
    dek_wrapped: wrapped,
    dek_kek_id: kekId,
    key_version: Number.isFinite(version) ? version : DEFAULT_KEY_VERSION,
    created_at: createdAt,
    algorithm: ALGORITHM,
  };
}

/**
 * Re-encrypts an entire record's PII fields to execute key rotation.
 */
export async function reencryptRecord(
  recordId: string,
  fields: Record<string, string | EncryptedField>,
  actor: string,
  reason: string,
  requestId: string,
  newKekId?: string,
  newKeyVersion?: number,
): Promise<Record<string, EncryptedField>> {
  const result: Record<string, EncryptedField> = {};

  for (const [fieldName, val] of Object.entries(fields)) {
    if (typeof val === 'string') {
      if (val.startsWith('pii:v')) {
        const deserialized = deserializeEncryptedField(val);
        result[fieldName] = await reencryptField(
          recordId,
          fieldName,
          deserialized,
          actor,
          reason,
          requestId,
          newKekId,
          newKeyVersion,
        );
      } else {
        // Plaintext -> initial encryption
        result[fieldName] = await encryptField(val, {
          kekId: newKekId,
          keyVersion: newKeyVersion,
        });
      }
    } else {
      result[fieldName] = await reencryptField(
        recordId,
        fieldName,
        val,
        actor,
        reason,
        requestId,
        newKekId,
        newKeyVersion,
      );
    }
  }

  return result;
}

/**
 * Migration helper for batch migrating legacy unencrypted or older DEK version data.
 */
export async function migratePiiData(
  records: Array<{ id: string; [field: string]: unknown }>,
  piiFields: string[],
  actor = 'migration_service',
  reason = '90_day_key_rotation',
  requestId = crypto.randomUUID(),
): Promise<{ migratedCount: number; errors: string[] }> {
  let migratedCount = 0;
  const errors: string[] = [];

  for (const record of records) {
    try {
      const recordId = String(record.id);
      const fieldsToMigrate: Record<string, string | EncryptedField> = {};

      for (const field of piiFields) {
        if (record[field] !== undefined && record[field] !== null) {
          fieldsToMigrate[field] = record[field] as string | EncryptedField;
        }
      }

      if (Object.keys(fieldsToMigrate).length > 0) {
        await reencryptRecord(recordId, fieldsToMigrate, actor, reason, requestId);
        migratedCount++;
      }
    } catch (err) {
      errors.push(`Record ${record.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { migratedCount, errors };
}

/**
 * Emits key rotation audit log and notifies listeners.
 */
export async function logKeyRotationAlert(alert: KeyRotationAlert): Promise<void> {
  logger.withContext().info('PII Key Rotation Executed', {
    kekId: alert.kekId,
    keyVersion: alert.keyVersion,
    rotatedAt: alert.rotatedAt,
    reason: alert.reason,
    affectedRecords: alert.affectedRecords,
  });

  for (const listener of rotationListeners) {
    try {
      await listener(alert);
    } catch (err) {
      logger.withContext().error('Key rotation listener error', { error: err });
    }
  }
}

async function logPiiAccess(
  recordId: string,
  field: string,
  actor: string,
  reason: string,
  requestId: string,
): Promise<void> {
  try {
    if (pool && typeof pool.query === 'function') {
      await pool.query(
        `INSERT INTO pii_access_log (id, actor, record_id, field, reason, request_id, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
        [actor, recordId, field, reason, requestId],
      );
    }
  } catch (err) {
    // Audit logging failure should not leak PII in error messages
    logger.withContext().warn('Failed to insert PII access audit log', {
      actor,
      field,
      recordId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function maskValue(value: string, field: 'email' | 'phone' | 'name' | 'address'): string {
  if (!value) return '***';

  if (field === 'email') {
    const [local, domain] = value.split('@');
    if (!domain) return '***';
    const maskedLocal = local && local.length > 0 ? local[0] + '***' : '***';
    const domainParts = domain.split('.');
    const maskedDomain =
      domainParts.length > 1 ? domainParts[0]![0] + '***.' + domainParts.slice(1).join('.') : '***';
    return `${maskedLocal}@${maskedDomain}`;
  }

  if (field === 'phone') {
    if (value.length <= 4) return '****';
    return '+xx...****' + value.slice(-2);
  }

  if (field === 'name') {
    if (value.length <= 1) return '*';
    return value[0]! + '***' + (value.length > 1 ? value.slice(-1) : '');
  }

  if (field === 'address') {
    if (value.length <= 4) return '****';
    const parts = value.split(' ');
    if (parts.length > 1) {
      return `${parts[0]![0]}*** ${parts[parts.length - 1]}`;
    }
    return value[0]! + '***' + value.slice(-2);
  }

  return '***';
}
