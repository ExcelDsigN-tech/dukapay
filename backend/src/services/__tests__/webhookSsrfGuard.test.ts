/**
 * Regression tests for issue #641 — SSRF guard at dispatch time.
 *
 * Verifies that postWebhook (called from sendToWebhook / retryWebhookDelivery)
 * re-validates the resolved IP on every dispatch, not just the hostname at
 * registration time. This closes the DNS-rebinding bypass where a hostname
 * resolves to a public IP at registration but is later repointed to an
 * internal address before dispatch.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// ---- mock db/connection so webhookService can be imported ----
const mockQuery = jest
  .fn<() => Promise<{ rows: unknown[]; rowCount?: number }>>()
  .mockResolvedValue({ rows: [] });

jest.unstable_mockModule('../../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
}));

// ---- mock logger to suppress noise ----
jest.unstable_mockModule('../../utils/logger.js', () => ({
  default: {
    withContext: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
    debug: jest.fn(),
  },
}));

// ---- mock dns/promises so we control what the hostname resolves to ----
const mockResolve4 = jest.fn<() => Promise<string[]>>();
const mockResolve6 = jest.fn<() => Promise<string[]>>();

jest.unstable_mockModule('node:dns/promises', () => ({
  default: { resolve4: mockResolve4, resolve6: mockResolve6 },
  resolve4: mockResolve4,
  resolve6: mockResolve6,
}));

// ---- global fetch mock ----
const mockFetch = jest.fn<() => Promise<Response>>();
global.fetch = mockFetch as unknown as typeof fetch;

const { WebhookService } = await import('../webhookService.js');

const SAFE_EVENT = {
  eventId: 'evt-test-001',
  eventType: 'LoanApproved' as const,
  loanId: 1,
  ledger: 100,
  ledgerClosedAt: new Date(),
  txHash: 'abc123',
  contractId: 'CABC',
  topics: [],
  value: '{}',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockResolve6.mockRejectedValue(new Error('no AAAA'));
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('dispatch-time IP validation (DNS-rebinding SSRF guard)', () => {
  it('blocks dispatch when hostname resolves to loopback (127.0.0.1)', async () => {
    mockResolve4.mockResolvedValue(['127.0.0.1']);
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 1, callback_url: 'https://legit-at-reg.example.com/hook', secret: null }],
    });

    const svc = new WebhookService();
    // dispatch should NOT throw (it catches internally), but fetch must not be called
    await svc.dispatch(SAFE_EVENT);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks dispatch when hostname resolves to RFC1918 address (10.x)', async () => {
    mockResolve4.mockResolvedValue(['10.0.0.1']);
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 2, callback_url: 'https://rebind.example.com/hook', secret: null }],
    });

    const svc = new WebhookService();
    await svc.dispatch(SAFE_EVENT);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks dispatch when hostname resolves to cloud metadata IP (169.254.169.254)', async () => {
    mockResolve4.mockResolvedValue(['169.254.169.254']);
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 3, callback_url: 'https://meta.example.com/hook', secret: null }],
    });

    const svc = new WebhookService();
    await svc.dispatch(SAFE_EVENT);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('blocks dispatch for inline private IP literal in callback URL', async () => {
    // No DNS resolution needed for IP literals
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 4, callback_url: 'http://192.168.1.100/hook', secret: null }],
    });

    const svc = new WebhookService();
    await svc.dispatch(SAFE_EVENT);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('allows dispatch when hostname resolves to a public IP', async () => {
    mockResolve4.mockResolvedValue(['203.0.113.42']); // TEST-NET, public range
    mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 5, callback_url: 'https://public.example.com/hook', secret: null }],
      })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const svc = new WebhookService();
    await svc.dispatch(SAFE_EVENT);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retryWebhookDelivery blocks when callback URL now resolves to private IP', async () => {
    mockResolve4.mockResolvedValue(['172.16.0.1']);

    await expect(
      WebhookService.retryWebhookDelivery(
        10,
        1,
        'https://rebind.example.com/hook',
        undefined,
        'evt-retry-001',
        'LoanApproved',
        { eventId: 'evt-retry-001', eventType: 'LoanApproved' },
        1,
      ),
    ).rejects.toThrow(/disallowed address/i);

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
