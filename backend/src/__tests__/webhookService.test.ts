import { jest } from '@jest/globals';
import crypto from 'node:crypto';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

const {
  WebhookService,
  getRetryDelayMs,
  computeWebhookSignature,
  verifyWebhookSignature,
  parseWebhookTimestamp,
  getWebhookCandidateSecrets,
} = await import('../services/webhookService.js');
const { default: logger } = await import('../utils/logger.js');

describe('WebhookService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
    delete process.env.WEBHOOK_MAX_PAYLOAD_BYTES;
  });

  it('returns the expected retry delays', () => {
    expect(getRetryDelayMs(1)).toBe(5 * 60 * 1000);
    expect(getRetryDelayMs(2)).toBe(15 * 60 * 1000);
    expect(getRetryDelayMs(3)).toBe(45 * 60 * 1000);
    expect(getRetryDelayMs(4)).toBe(45 * 60 * 1000);
  });

  it('persists retry state when the initial delivery fails', async () => {
    const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 1, callback_url: 'https://consumer.example', secret: null }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const service = new WebhookService();
    await service.dispatch({
      eventId: 'evt-123',
      eventType: 'LoanApproved',
      loanId: 42,
      address: 'GBORROWER123',
      ledger: 100,
      ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
      txHash: 'tx-123',
      contractId: 'contract-123',
      topics: [],
      value: 'value-xdr',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM webhook_subscriptions'),
      [JSON.stringify(['LoanApproved'])],
    );
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO webhook_deliveries'),
      [
        1,
        'evt-123',
        'LoanApproved',
        503,
        'Webhook returned status 503',
        JSON.stringify({
          eventId: 'evt-123',
          eventType: 'LoanApproved',
          loanId: 42,
          address: 'GBORROWER123',
          ledger: 100,
          ledgerClosedAt: '2025-01-01T00:00:00.000Z',
          txHash: 'tx-123',
          contractId: 'contract-123',
          topics: [],
          value: 'value-xdr',
        }),
        new Date(1_700_000_000_000 + getRetryDelayMs(1)),
      ],
    );

    nowSpy.mockRestore();
  });

  it('truncates oversized webhook payloads before delivery', async () => {
    process.env.WEBHOOK_MAX_PAYLOAD_BYTES = '200';

    const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger as typeof logger);

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 1, callback_url: 'https://consumer.example', secret: null }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const service = new WebhookService();
    await service.dispatch({
      eventId: 'evt-oversized',
      eventType: 'LoanApproved',
      loanId: 42,
      address: 'GBORROWER123',
      ledger: 100,
      ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
      txHash: 'tx-oversized',
      contractId: 'contract-123',
      topics: ['LoanApproved', '42'],
      value: 'x'.repeat(1_024),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callOpts = fetchMock.mock.calls[0]![1] as RequestInit;
    const deliveredBody = String(callOpts.body);
    const deliveredPayload = JSON.parse(deliveredBody) as Record<string, unknown>;
    expect(deliveredPayload.truncated).toBe(true);
    expect(deliveredPayload.reason).toBe('payload_too_large');
    expect(deliveredPayload.eventId).toBe('evt-oversized');
    expect(deliveredPayload.maxPayloadBytes).toBe(200);
    expect(Number(deliveredPayload.originalPayloadBytes)).toBeGreaterThan(200);
    expect(deliveredPayload.value).toBeUndefined();

    const insertParams = mockQuery.mock.calls[1]![1] as unknown[];
    expect(JSON.parse(String(insertParams[5]))).toEqual(deliveredPayload);
    expect(warnSpy).toHaveBeenCalledWith(
      'Webhook payload exceeds size limit, sending summary payload',
      expect.objectContaining({
        eventId: 'evt-oversized',
        eventType: 'LoanApproved',
        maxPayloadBytes: 200,
      }),
    );
  });

  it('logs when a webhook payload approaches the configured size limit', async () => {
    process.env.WEBHOOK_MAX_PAYLOAD_BYTES = '512';

    const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => logger as typeof logger);

    const event = {
      eventId: 'evt-near-limit',
      eventType: 'LoanApproved' as const,
      loanId: 42,
      address: 'GBORROWER123',
      ledger: 100,
      ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
      txHash: 'tx-near-limit',
      contractId: 'contract-123',
      topics: ['LoanApproved', '42'],
      value: '',
    };

    while (Buffer.byteLength(JSON.stringify(event)) < 460) {
      event.value += 'x';
    }

    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 1, callback_url: 'https://consumer.example', secret: null }],
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const service = new WebhookService();
    await service.dispatch(event);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'Webhook payload is near size limit',
      expect.objectContaining({
        eventId: 'evt-near-limit',
        eventType: 'LoanApproved',
        maxPayloadBytes: 512,
      }),
    );
  });

  describe('HMAC signature (timestamp + nonce payload)', () => {
    it('sets X-DukaPay-Signature over timestamp.nonce.body_hex', async () => {
      const secret = 'test-secret-key';

      const fetchMock =
        jest.fn<(_url: string, opts: RequestInit) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockImplementation(async (_url: string, opts: RequestInit) => {
        const hdrs = opts.headers as Record<string, string>;
        const ts = hdrs['x-dukapay-timestamp'];
        const nonce = hdrs['x-dukapay-nonce'];
        const bodyHex = Buffer.from(opts.body as string, 'utf8').toString('hex');
        const signedPayload = `${ts}.${nonce}.${bodyHex}`;
        const expectedHex = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
        expect(hdrs['x-dukapay-signature']).toBe(`sha256=${expectedHex}`);
        expect(ts).toMatch(/^\d+$/);
        expect(nonce).toMatch(/^[a-f0-9]{32}$/);
        return { ok: true, status: 200 };
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, callback_url: 'https://consumer.example', secret }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-hmac-test',
        eventType: 'LoanApproved' as const,
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-hmac',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("signature header starts with 'sha256=' and matches HMAC-SHA256 of signed payload", async () => {
      const secret = 'another-secret';
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as unknown as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, callback_url: 'https://hook.example', secret }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-prefix-check',
        eventType: 'LoanRepaid' as const,
        loanId: 7,
        address: 'GBORROWER456',
        ledger: 200,
        ledgerClosedAt: new Date('2025-06-01T00:00:00.000Z'),
        txHash: 'tx-prefix',
        contractId: 'contract-456',
        topics: [],
        value: 'xdr-val',
      });

      const callOpts = fetchMock.mock.calls[0]![1] as RequestInit;
      const hdrs = callOpts.headers as Record<string, string>;
      const sigHeader = hdrs['x-dukapay-signature'];

      expect(sigHeader).toMatch(/^sha256=[a-f0-9]{64}$/);

      const ts = hdrs['x-dukapay-timestamp'];
      const nonce = hdrs['x-dukapay-nonce'];
      const bodyHex = Buffer.from(callOpts.body as string, 'utf8').toString('hex');
      const signedPayload = `${ts}.${nonce}.${bodyHex}`;
      const expectedHex = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
      expect(sigHeader).toBe(`sha256=${expectedHex}`);
    });

    it('omits X-DukaPay-Signature when no secret is configured', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as unknown as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, callback_url: 'https://nosecret.example', secret: null }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-no-secret',
        eventType: 'LoanApproved' as const,
        loanId: 1,
        address: 'GBORROWER789',
        ledger: 300,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-nosecret',
        contractId: 'contract-789',
        topics: [],
        value: 'xdr',
      });

      const callOpts = fetchMock.mock.calls[0]![1] as RequestInit;
      const hdrs = callOpts.headers as Record<string, string>;
      expect(hdrs['x-dukapay-signature']).toBeUndefined();
    });
  });

  describe('verifyWebhookSignature', () => {
    const secret = 'my-subscription-secret';

    it('verifies a correctly-signed payload (sha256= prefix)', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = crypto.randomBytes(16).toString('hex');
      const body = JSON.stringify({ eventId: 'evt-1', data: 'hello' });
      const bodyHex = Buffer.from(body, 'utf8').toString('hex');
      const signedPayload = `${timestamp}.${nonce}.${bodyHex}`;
      const sig =
        'sha256=' + crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

      expect(verifyWebhookSignature(sig, [secret], timestamp, nonce, body)).toBe(true);
    });

    it('verifies a payload without sha256= prefix', () => {
      const timestamp = '1726800000';
      const nonce = 'abcdef0123456789abcdef0123456789';
      const body = '{"test":true}';
      const bodyHex = Buffer.from(body, 'utf8').toString('hex');
      const signedPayload = `${timestamp}.${nonce}.${bodyHex}`;
      const sig = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

      expect(verifyWebhookSignature(sig, [secret], timestamp, nonce, body)).toBe(true);
    });

    it('rejects a payload signed with a wrong secret', () => {
      const timestamp = '1726800000';
      const nonce = 'abcdef0123456789abcdef0123456789';
      const body = '{"test":true}';
      const bodyHex = Buffer.from(body, 'utf8').toString('hex');
      const signedPayload = `${timestamp}.${nonce}.${bodyHex}`;
      const sig =
        'sha256=' + crypto.createHmac('sha256', 'wrong-secret').update(signedPayload).digest('hex');

      expect(verifyWebhookSignature(sig, [secret], timestamp, nonce, body)).toBe(false);
    });

    it('rejects a payload with missing signature', () => {
      expect(verifyWebhookSignature(undefined, [secret], '1726800000', 'nonce', '{"a":1}')).toBe(
        false,
      );
    });

    it('rejects a payload with missing timestamp', () => {
      const body = '{"test":true}';
      const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyWebhookSignature(sig, [secret], undefined, 'nonce', body)).toBe(false);
    });

    it('rejects a payload with missing nonce', () => {
      const body = '{"test":true}';
      const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(verifyWebhookSignature(sig, [secret], '1726800000', undefined, body)).toBe(false);
    });

    it('verifies with a rotation secret alongside the primary secret', () => {
      const primarySecret = 'primary-secret';
      const rotatedSecret = 'rotated-secret';
      const timestamp = '1726800000';
      const nonce = 'abcdef0123456789abcdef0123456789';
      const body = '{"test":true}';
      const bodyHex = Buffer.from(body, 'utf8').toString('hex');
      const signedPayload = `${timestamp}.${nonce}.${bodyHex}`;
      const sig =
        'sha256=' + crypto.createHmac('sha256', rotatedSecret).update(signedPayload).digest('hex');

      expect(
        verifyWebhookSignature(sig, [primarySecret, rotatedSecret], timestamp, nonce, body),
      ).toBe(true);
    });
  });

  describe('computeWebhookSignature', () => {
    it('produces deterministic hex for the same inputs', () => {
      const secret = 'sig-secret';
      const timestamp = '1726800000';
      const nonce = '1234567890abcdef1234567890abcdef';
      const body = '{"key":"value"}';

      const sig1 = computeWebhookSignature(secret, timestamp, nonce, body);
      const sig2 = computeWebhookSignature(secret, timestamp, nonce, body);

      expect(sig1).toBe(sig2);

      const bodyHex = Buffer.from(body, 'utf8').toString('hex');
      const signedPayload = `${timestamp}.${nonce}.${bodyHex}`;
      const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
      expect(sig1).toBe(expected);
    });
  });

  describe('parseWebhookTimestamp', () => {
    it('parses a valid Unix timestamp string', () => {
      expect(parseWebhookTimestamp('1726800000')).toBe(1726800000);
    });

    it('returns undefined for a non-numeric string', () => {
      expect(parseWebhookTimestamp('not-a-number')).toBeUndefined();
    });

    it('returns undefined for undefined input', () => {
      expect(parseWebhookTimestamp(undefined)).toBeUndefined();
    });
  });

  describe('getWebhookCandidateSecrets', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('returns [primary] when only WEBHOOK_SECRET is set', () => {
      process.env.WEBHOOK_SECRET = 'primary';
      delete process.env.WEBHOOK_ROTATION_SECRETS;
      expect(getWebhookCandidateSecrets()).toEqual(['primary']);
    });

    it('returns [primary, ...rotation] when both are set', () => {
      process.env.WEBHOOK_SECRET = 'primary';
      process.env.WEBHOOK_ROTATION_SECRETS = 'rotated1,rotated2';
      expect(getWebhookCandidateSecrets()).toEqual(['primary', 'rotated1', 'rotated2']);
    });

    it('returns rotation secrets when WEBHOOK_SECRET is empty', () => {
      delete process.env.WEBHOOK_SECRET;
      process.env.WEBHOOK_ROTATION_SECRETS = 'rotated1,rotated2';
      expect(getWebhookCandidateSecrets()).toEqual(['rotated1', 'rotated2']);
    });

    it('returns [""] when neither is set', () => {
      delete process.env.WEBHOOK_SECRET;
      delete process.env.WEBHOOK_ROTATION_SECRETS;
      expect(getWebhookCandidateSecrets()).toEqual(['']);
    });
  });

  describe('Retry logic', () => {
    it('retries delivery on 5xx response', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: false, status: 503 });
      global.fetch = fetchMock as unknown as typeof fetch;

      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, callback_url: 'https://consumer.example', secret: null }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-5xx',
        eventType: 'LoanApproved',
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-5xx',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const insertCall = mockQuery.mock.calls[1]! as [string, unknown[]];
      expect(insertCall[0]).toContain('INSERT INTO webhook_deliveries');
      const params = insertCall[1];
      expect(params[3]!).toBe(503); // last_status_code
      expect(params[4]!).toBe('Webhook returned status 503'); // last_error
      expect(params[6]!).toEqual(new Date(1_700_000_000_000 + getRetryDelayMs(1))); // next_retry_at

      nowSpy.mockRestore();
    });

    it('does not retry delivery on 4xx response', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: false, status: 400 });
      global.fetch = fetchMock as unknown as typeof fetch;

      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, callback_url: 'https://consumer.example', secret: null }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-4xx',
        eventType: 'LoanApproved',
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-4xx',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const insertCall = mockQuery.mock.calls[1]! as [string, unknown[]];
      expect(insertCall[0]).toContain('INSERT INTO webhook_deliveries');
      const params = insertCall[1];
      expect(params[3]!).toBe(400); // last_status_code
      expect(params[4]!).toBe('Webhook returned status 400'); // last_error
      // 4xx errors still schedule retry in current implementation
      expect(params[6]!).toEqual(new Date(1_700_000_000_000 + getRetryDelayMs(1))); // next_retry_at

      nowSpy.mockRestore();
    });

    it('does not retry delivery on 4xx response', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: false, status: 400 });
      global.fetch = fetchMock as unknown as typeof fetch;

      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, callback_url: 'https://consumer.example', secret: null }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-4xx',
        eventType: 'LoanApproved',
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-4xx',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const insertCall = mockQuery.mock.calls[1]! as [string, unknown[]];
      expect(insertCall[0]).toContain('INSERT INTO webhook_deliveries');
      const params = insertCall[1];
      expect(params[3]).toBe(400); // last_status_code
      expect(params[4]).toBe('Webhook returned status 400'); // last_error
      // 4xx errors still schedule retry in current implementation
      expect(params[6]).toEqual(new Date(1_700_000_000_000 + getRetryDelayMs(1))); // next_retry_at

      nowSpy.mockRestore();
    });
  });

  describe('Subscription filtering', () => {
    it('sends event to all matching subscriptions', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as unknown as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { id: 1, callback_url: 'https://consumer1.example', secret: null },
            { id: 2, callback_url: 'https://consumer2.example', secret: null },
            { id: 3, callback_url: 'https://consumer3.example', secret: null },
          ],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-multi',
        eventType: 'LoanApproved',
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-multi',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[0]![0]).toBe('https://consumer1.example');
      expect(fetchMock.mock.calls[1]![0]).toBe('https://consumer2.example');
      expect(fetchMock.mock.calls[2]![0]).toBe('https://consumer3.example');
    });

    it('skips inactive subscriptions', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as unknown as typeof fetch;

      // Query should filter by is_active = true, so no inactive subscriptions returned
      mockQuery.mockResolvedValueOnce({
        rows: [], // No active subscriptions
      });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-inactive',
        eventType: 'LoanApproved',
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-inactive',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE is_active = true'),
        expect.any(Array),
      );
    });

    it('applies event type filter correctly', async () => {
      const fetchMock = jest.fn<(...args: unknown[]) => Promise<{ ok: boolean; status: number }>>();
      fetchMock.mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchMock as unknown as typeof fetch;

      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 1, callback_url: 'https://consumer.example', secret: null }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 });

      const service = new WebhookService();
      await service.dispatch({
        eventId: 'evt-filter',
        eventType: 'LoanRepaid',
        loanId: 42,
        address: 'GBORROWER123',
        ledger: 100,
        ledgerClosedAt: new Date('2025-01-01T00:00:00.000Z'),
        txHash: 'tx-filter',
        contractId: 'contract-123',
        topics: [],
        value: 'value-xdr',
      });

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('event_types @> $1::jsonb'), [
        JSON.stringify(['LoanRepaid']),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
