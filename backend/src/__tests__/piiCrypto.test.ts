import { jest } from '@jest/globals';
import type { KeyRotationAlert } from '../services/piiCrypto.js';

const mockPoolQuery = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  pool: { query: mockPoolQuery },
  query: jest.fn(),
}));

await import('../db/connection.js');
const {
  encryptField,
  decryptField,
  isDekExpired,
  reencryptField,
  serializeEncryptedField,
  deserializeEncryptedField,
  reencryptRecord,
  migratePiiData,
  logKeyRotationAlert,
  onKeyRotationAlert,
  maskValue,
} = await import('../services/piiCrypto.js');

describe('piiCrypto System Integration Tests', () => {
  const testKekKey = '0'.repeat(64);

  beforeAll(() => {
    process.env.PII_KEK_KEY = testKekKey;
    process.env.PII_KEK_ID = 'test-kek-id-v1';
  });

  afterAll(() => {
    delete process.env.PII_KEK_KEY;
    delete process.env.PII_KEK_ID;
    delete process.env.PII_KMS_ENDPOINT;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('encryptField / decryptField Round Trip', () => {
    it('encrypts and decrypts a sensitive PII field using default options', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] }); // pii_access_log insert

      const plaintext = 'sensitive-user-national-id-987654';
      const encrypted = await encryptField(plaintext);

      expect(encrypted.ciphertext).toBeInstanceOf(Buffer);
      expect(encrypted.gcm_nonce).toHaveLength(12);
      expect(encrypted.dek_wrapped).toBeInstanceOf(Buffer);
      expect(encrypted.dek_kek_id).toBe('test-kek-id-v1');
      expect(encrypted.key_version).toBe(1);
      expect(encrypted.algorithm).toBe('aes-256-gcm');
      expect(encrypted.created_at).toBeDefined();

      const decrypted = await decryptField(
        'rec-101',
        'national_id',
        encrypted.ciphertext,
        encrypted.gcm_nonce,
        encrypted.dek_wrapped,
        encrypted.dek_kek_id,
        'compliance_officer',
        'kyc_verification',
        'req-abc-123',
      );

      expect(decrypted).toBe(plaintext);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO pii_access_log'),
        ['compliance_officer', 'rec-101', 'national_id', 'kyc_verification', 'req-abc-123'],
      );
    });

    it('encrypts with custom kekId and keyVersion', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      const plaintext = 'john.doe@dukapay.org';
      const encrypted = await encryptField(plaintext, { kekId: 'custom-kek-v2', keyVersion: 3 });

      expect(encrypted.dek_kek_id).toBe('custom-kek-v2');
      expect(encrypted.key_version).toBe(3);

      const decrypted = await decryptField(
        'rec-102',
        'email',
        encrypted.ciphertext,
        encrypted.gcm_nonce,
        encrypted.dek_wrapped,
        encrypted.dek_kek_id,
        'user_self',
        'profile_view',
        'req-456',
      );

      expect(decrypted).toBe(plaintext);
    });

    it('throws error when ciphertext has been tampered with or corrupt auth tag', async () => {
      const encrypted = await encryptField('confidential_data');
      const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
      // Alter last byte of auth tag
      tamperedCiphertext[tamperedCiphertext.length - 1] ^= 0xff;

      await expect(
        decryptField(
          'rec-103',
          'secret',
          tamperedCiphertext,
          encrypted.gcm_nonce,
          encrypted.dek_wrapped,
          encrypted.dek_kek_id,
          'attacker',
          'tamper',
          'req-999',
        ),
      ).rejects.toThrow();
    });

    it('handles database logging failure during decryption without leaking PII', async () => {
      mockPoolQuery.mockRejectedValueOnce(new Error('Database disk full'));

      const plaintext = 'user_home_address_street';
      const encrypted = await encryptField(plaintext);

      const decrypted = await decryptField(
        'rec-104',
        'address',
        encrypted.ciphertext,
        encrypted.gcm_nonce,
        encrypted.dek_wrapped,
        encrypted.dek_kek_id,
        'system',
        'read',
        'req-db-fail',
      );

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('KMS Integration Mocking', () => {
    afterEach(() => {
      delete process.env.PII_KMS_ENDPOINT;
      // @ts-expect-error cleanup global fetch mock if any
      delete global.fetch;
    });

    it('wraps and unwraps DEK using KMS endpoint when PII_KMS_ENDPOINT is set', async () => {
      process.env.PII_KMS_ENDPOINT = 'http://kms.internal.local';

      const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

      let capturedDekBase64 = '';

      // Mock wrap call (POST /encrypt)
      mockFetch.mockImplementationOnce(async (url, init) => {
        const body = JSON.parse(init?.body as string);
        capturedDekBase64 = body.plaintext;
        return {
          ok: true,
          json: async () => ({ wrapped_key: Buffer.from('kms_wrapped_bytes').toString('base64') }),
        } as Response;
      });

      // Mock unwrap call (POST /decrypt)
      mockFetch.mockImplementationOnce(async () => {
        return {
          ok: true,
          json: async () => ({ plaintext: capturedDekBase64 }),
        } as Response;
      });

      global.fetch = mockFetch;
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      const encrypted = await encryptField('kms_secret_payload', { kekId: 'kms-kek-v1' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://kms.internal.local/encrypt',
        expect.objectContaining({ method: 'POST' }),
      );

      const decrypted = await decryptField(
        'rec-kms',
        'secret',
        encrypted.ciphertext,
        encrypted.gcm_nonce,
        encrypted.dek_wrapped,
        encrypted.dek_kek_id,
        'actor',
        'read',
        'req-kms',
      );

      expect(mockFetch).toHaveBeenCalledWith(
        'http://kms.internal.local/decrypt',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(decrypted).toBe('kms_secret_payload');
    });

    it('throws error when KMS wrap endpoint returns non-OK status', async () => {
      process.env.PII_KMS_ENDPOINT = 'http://kms.internal.local';

      const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 } as Response);
      global.fetch = mockFetch;

      await expect(encryptField('test')).rejects.toThrow('KMS wrap failed: 500');
    });

    it('throws error when KMS unwrap endpoint returns non-OK status', async () => {
      process.env.PII_KMS_ENDPOINT = 'http://kms.internal.local';

      const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ wrapped_key: Buffer.from('wrapped').toString('base64') }),
      } as Response);
      mockFetch.mockResolvedValueOnce({ ok: false, status: 403 } as Response);
      global.fetch = mockFetch;

      const encrypted = await encryptField('test');

      await expect(
        decryptField(
          'rec-1',
          'f',
          encrypted.ciphertext,
          encrypted.gcm_nonce,
          encrypted.dek_wrapped,
          encrypted.dek_kek_id,
          'a',
          'r',
          'req-1',
        ),
      ).rejects.toThrow('KMS unwrap failed: 403');
    });
  });

  describe('isDekExpired', () => {
    it('returns false for undefined or invalid createdAt values', () => {
      expect(isDekExpired(undefined)).toBe(false);
      expect(isDekExpired('invalid-date-string')).toBe(false);
    });

    it('returns true when DEK created date exceeds maxAgeDays', () => {
      const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
      expect(isDekExpired(ninetyOneDaysAgo, 90)).toBe(true);

      const tenDaysAgoTimestamp = Date.now() - 10 * 24 * 60 * 60 * 1000;
      expect(isDekExpired(tenDaysAgoTimestamp, 90)).toBe(false);
    });
  });

  describe('Serialization & Deserialization', () => {
    it('serializes and deserializes EncryptedField to/from portable string token format', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      const plaintext = 'SuperSecretToken123';
      const encrypted = await encryptField(plaintext, { kekId: 'kek-v5', keyVersion: 5 });
      const serialized = serializeEncryptedField(encrypted);

      expect(serialized).toMatch(/^pii:v5:kek-v5:/);

      const deserialized = deserializeEncryptedField(serialized);
      expect(deserialized.key_version).toBe(5);
      expect(deserialized.dek_kek_id).toBe('kek-v5');
      expect(deserialized.ciphertext).toEqual(encrypted.ciphertext);
      expect(deserialized.gcm_nonce).toEqual(encrypted.gcm_nonce);

      const decrypted = await decryptField(
        'rec-ser',
        'token',
        deserialized.ciphertext,
        deserialized.gcm_nonce,
        deserialized.dek_wrapped,
        deserialized.dek_kek_id,
        'admin',
        'read',
        'req-ser-1',
      );

      expect(decrypted).toBe(plaintext);
    });

    it('throws error when deserializing payload without pii:v prefix', () => {
      expect(() => deserializeEncryptedField('invalid:format:token')).toThrow(
        'Invalid encrypted PII payload format',
      );
    });

    it('throws error when deserializing payload with missing colon-separated parts', () => {
      expect(() => deserializeEncryptedField('pii:v1:kek1:nonce')).toThrow(
        'Malformed encrypted PII payload',
      );
    });

    it('handles fallback version parsing and missing createdAt during deserialization', () => {
      const payload = 'pii:vINVALID:mykek:0102:0304:0506';
      const deserialized = deserializeEncryptedField(payload);
      expect(deserialized.key_version).toBe(1);
      expect(deserialized.dek_kek_id).toBe('mykek');
      expect(deserialized.created_at).toBeUndefined();
    });
  });

  describe('Re-encryption & Key Rotation', () => {
    it('reencrypts individual field and notifies rotation listeners', async () => {
      const alerts: KeyRotationAlert[] = [];
      const unsubscribe = onKeyRotationAlert((alert) => {
        alerts.push(alert);
      });

      mockPoolQuery.mockResolvedValue({ rows: [] });

      const initial = await encryptField('secret-field-val', { kekId: 'kek-v1', keyVersion: 1 });
      const reencrypted = await reencryptField(
        'rec-rot-1',
        'ssn',
        initial,
        'cron_rotator',
        'scheduled_rotation',
        'req-rot-100',
        'kek-v2',
        2,
      );

      expect(reencrypted.dek_kek_id).toBe('kek-v2');
      expect(reencrypted.key_version).toBe(2);

      const decrypted = await decryptField(
        'rec-rot-1',
        'ssn',
        reencrypted.ciphertext,
        reencrypted.gcm_nonce,
        reencrypted.dek_wrapped,
        reencrypted.dek_kek_id,
        'auditor',
        'audit',
        'req-rot-101',
      );
      expect(decrypted).toBe('secret-field-val');

      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.kekId).toBe('kek-v2');
      expect(alerts[0]?.keyVersion).toBe(2);

      unsubscribe();
    });

    it('reencrypts entire record containing plaintext string, token string, and EncryptedField struct', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] });

      const initialField = await encryptField('initial_address', { kekId: 'v1', keyVersion: 1 });
      const tokenString = serializeEncryptedField(initialField);

      const recordToRotate = {
        name: 'Jane Smith', // plaintext
        email: tokenString, // serialized token
        address: initialField, // EncryptedField struct
      };

      const rotatedRecord = await reencryptRecord(
        'rec-record-1',
        recordToRotate,
        'rotation_service',
        'annual_key_rotation',
        'req-rec-rot',
        'kek-v3',
        3,
      );

      expect(rotatedRecord['name']?.key_version).toBe(3);
      expect(rotatedRecord['email']?.key_version).toBe(3);
      expect(rotatedRecord['address']?.key_version).toBe(3);

      const decryptedName = await decryptField(
        'rec-record-1',
        'name',
        rotatedRecord['name']!.ciphertext,
        rotatedRecord['name']!.gcm_nonce,
        rotatedRecord['name']!.dek_wrapped,
        rotatedRecord['name']!.dek_kek_id,
        'user',
        'read',
        'req-read-name',
      );
      expect(decryptedName).toBe('Jane Smith');
    });

    it('migrates PII data in batch and captures record-level errors', async () => {
      mockPoolQuery.mockResolvedValue({ rows: [] });

      const records = [
        { id: '1', email: 'worker1@dukapay.org', phone: '+254700000001' },
        { id: '2', email: 'worker2@dukapay.org', phone: '+254700000002' },
        { id: '3' }, // record with no matching fields
      ];

      const res = await migratePiiData(records, ['email', 'phone']);

      expect(res.migratedCount).toBe(2);
      expect(res.errors).toHaveLength(0);
    });

    it('records errors during migratePiiData when reencryptRecord fails', async () => {
      const records = [{ id: 'corrupt-record', email: 'pii:v1:kek:invalid_token' }];

      const res = await migratePiiData(records, ['email']);

      expect(res.migratedCount).toBe(0);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0]).toMatch(/Record corrupt-record/);
    });

    it('handles listener errors inside logKeyRotationAlert gracefully', async () => {
      const faultyListener = () => {
        throw new Error('Listener crash');
      };
      const unsubscribe = onKeyRotationAlert(faultyListener);

      await expect(
        logKeyRotationAlert({
          kekId: 'kek-test',
          keyVersion: 1,
          rotatedAt: new Date().toISOString(),
          reason: 'test',
        }),
      ).resolves.not.toThrow();

      unsubscribe();
    });
  });

  describe('maskValue Formatting', () => {
    it('returns *** for empty or null inputs', () => {
      expect(maskValue('', 'email')).toBe('***');
      // @ts-expect-error test null input handling
      expect(maskValue(null, 'phone')).toBe('***');
    });

    it('masks email addresses correctly across edge cases', () => {
      expect(maskValue('john.doe@example.com', 'email')).toBe('j***@e***.com');
      expect(maskValue('a@b.com', 'email')).toBe('a***@b***.com');
      expect(maskValue('invalidemail', 'email')).toBe('***');
      expect(maskValue('noextension@domain', 'email')).toBe('n***@***');
    });

    it('masks phone numbers correctly across edge cases', () => {
      expect(maskValue('+14155551234', 'phone')).toBe('+xx...****34');
      expect(maskValue('123', 'phone')).toBe('****');
    });

    it('masks names correctly across edge cases', () => {
      expect(maskValue('John Doe', 'name')).toBe('J***e');
      expect(maskValue('A', 'name')).toBe('*');
    });

    it('masks addresses correctly across edge cases', () => {
      expect(maskValue('123 Main Street', 'address')).toBe('1*** Street');
      expect(maskValue('Short', 'address')).toBe('S***rt');
      expect(maskValue('123', 'address')).toBe('****');
    });

    it('returns *** for unknown mask field types', () => {
      // @ts-expect-error test invalid field type
      expect(maskValue('something', 'unknown_field')).toBe('***');
    });
  });
});
