import {
  encryptField,
  decryptField,
  maskValue,
  isDekExpired,
  reencryptField,
  reencryptRecord,
  serializeEncryptedField,
  deserializeEncryptedField,
  migratePiiData,
  onKeyRotationAlert,
  type KeyRotationAlert,
} from '../piiCrypto.js';

describe('piiCrypto', () => {
  const testKekKey = '0'.repeat(64);

  beforeAll(() => {
    process.env.PII_KEK_KEY = testKekKey;
    process.env.PII_KEK_ID = 'test-kek';
    process.env.LOG_REDACTION = 'strict';
  });

  afterAll(() => {
    delete process.env.PII_KEK_KEY;
    delete process.env.PII_KEK_ID;
    delete process.env.LOG_REDACTION;
  });

  describe('encryptField / decryptField round trip', () => {
    it('should encrypt and decrypt a string field', async () => {
      const plaintext = 'user@example.com';
      const encrypted = await encryptField(plaintext, { kekId: 'test-kek', keyVersion: 1 });

      expect(encrypted.ciphertext).toBeInstanceOf(Buffer);
      expect(encrypted.gcm_nonce).toHaveLength(12);
      expect(encrypted.dek_wrapped).toBeInstanceOf(Buffer);
      expect(encrypted.dek_kek_id).toBe('test-kek');
      expect(encrypted.key_version).toBe(1);

      const decrypted = await decryptField(
        'rec-1',
        'email',
        encrypted.ciphertext,
        encrypted.gcm_nonce,
        encrypted.dek_wrapped,
        encrypted.dek_kek_id,
        'test_actor',
        'compliance_check',
        'req-123',
      );

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('key versioning and serialization', () => {
    it('should serialize and deserialize encrypted fields', async () => {
      const plaintext = 'Jane Doe';
      const encrypted = await encryptField(plaintext, { kekId: 'test-kek-v2', keyVersion: 2 });
      const serialized = serializeEncryptedField(encrypted);

      expect(serialized).toContain('pii:v2:test-kek-v2:');

      const deserialized = deserializeEncryptedField(serialized);
      expect(deserialized.key_version).toBe(2);
      expect(deserialized.dek_kek_id).toBe('test-kek-v2');

      const decrypted = await decryptField(
        'rec-2',
        'name',
        deserialized.ciphertext,
        deserialized.gcm_nonce,
        deserialized.dek_wrapped,
        deserialized.dek_kek_id,
        'test_actor',
        'auth_verification',
        'req-456',
      );

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('DEK expiration & rotation', () => {
    it('should detect when DEK is expired past 90 days', () => {
      const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

      expect(isDekExpired(ninetyOneDaysAgo, 90)).toBe(true);
      expect(isDekExpired(tenDaysAgo, 90)).toBe(false);
    });

    it('should re-encrypt field and trigger rotation alert', async () => {
      const alertEvents: KeyRotationAlert[] = [];
      const unsubscribe = onKeyRotationAlert((alert) => {
        alertEvents.push(alert);
      });

      const initial = await encryptField('secret-address-123', { kekId: 'kek-v1', keyVersion: 1 });
      const rotated = await reencryptField(
        'rec-3',
        'address',
        initial,
        'cron_rotation',
        '90_day_scheduled_rotation',
        'req-rot-1',
        'kek-v2',
        2,
      );

      expect(rotated.key_version).toBe(2);
      expect(rotated.dek_kek_id).toBe('kek-v2');

      const decrypted = await decryptField(
        'rec-3',
        'address',
        rotated.ciphertext,
        rotated.gcm_nonce,
        rotated.dek_wrapped,
        rotated.dek_kek_id,
        'auditor',
        'audit',
        'req-rot-2',
      );
      expect(decrypted).toBe('secret-address-123');

      expect(alertEvents.length).toBeGreaterThanOrEqual(1);
      expect(alertEvents[0]?.keyVersion).toBe(2);

      unsubscribe();
    });

    it('should reencrypt entire record with multiple PII fields', async () => {
      const record = {
        email: 'migrant@worker.org',
        phone: '+254712345678',
      };

      const encryptedRecord = await reencryptRecord(
        'rec-4',
        record,
        'migration_worker',
        'initial_encryption',
        'req-rec-1',
      );

      expect(encryptedRecord['email']).toBeDefined();
      expect(encryptedRecord['phone']).toBeDefined();

      const decryptedEmail = await decryptField(
        'rec-4',
        'email',
        encryptedRecord['email']!.ciphertext,
        encryptedRecord['email']!.gcm_nonce,
        encryptedRecord['email']!.dek_wrapped,
        encryptedRecord['email']!.dek_kek_id,
        'user',
        'read',
        'req-rec-2',
      );
      expect(decryptedEmail).toBe('migrant@worker.org');
    });

    it('should migrate data in batch', async () => {
      const records = [
        { id: '1', email: 'worker1@example.com', phone: '+1234567890' },
        { id: '2', email: 'worker2@example.com', phone: '+9876543210' },
      ];

      const result = await migratePiiData(records, ['email', 'phone']);
      expect(result.migratedCount).toBe(2);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('maskValue', () => {
    it('should mask email correctly', () => {
      const masked = maskValue('john.doe@example.com', 'email');
      expect(masked).toMatch(/^j\*\*\*@e\*\*\*\.com$/);
    });

    it('should mask short email correctly', () => {
      const masked = maskValue('a@b.com', 'email');
      expect(masked).toMatch(/^a\*\*\*@b\*\*\*\.com$/);
    });

    it('should mask phone correctly', () => {
      const masked = maskValue('+14155551234', 'phone');
      expect(masked).toBe('+xx...****34');
    });

    it('should mask short phone correctly', () => {
      const masked = maskValue('123', 'phone');
      expect(masked).toBe('****');
    });

    it('should mask name correctly', () => {
      const masked = maskValue('John Doe', 'name');
      expect(masked).toBe('J***e');
    });

    it('should mask single char name correctly', () => {
      const masked = maskValue('X', 'name');
      expect(masked).toBe('*');
    });

    it('should mask address correctly', () => {
      const masked = maskValue('123 Main Street', 'address');
      expect(masked).toBe('1*** Street');
    });
  });
});
