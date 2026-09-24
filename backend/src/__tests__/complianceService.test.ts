import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockQuery =
  jest.fn<(...args: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>>();
jest.unstable_mockModule('../db/connection.js', () => ({ query: mockQuery }));
jest.unstable_mockModule('../utils/logger.js', () => ({
  default: { withContext: () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }) },
}));

const originalFetch = globalThis.fetch;
const mockFetch = jest.fn<typeof fetch>();
globalThis.fetch = mockFetch;
const { complianceService } = await import('../services/complianceService.js');

describe('complianceService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.COMPLYADVANTAGE_API_KEY = 'test-only-key';
    delete process.env.SAR_FILING_API_URL;
    delete process.env.SAR_FILING_API_TOKEN;
    delete process.env.KYC_ENFORCEMENT_ENABLED;
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    delete process.env.COMPLYADVANTAGE_API_KEY;
  });

  it('approves an applicant with no sanctions, PEP, or adverse-media hits', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ content: { data: { id: 42, hits: [] } } }), { status: 200 }),
    );

    const result = await complianceService.screenApplicant({
      subjectId: 'GTEST',
      firstName: 'Test',
      lastName: 'Person',
      countryCode: 'NG',
    });

    expect(result.status).toBe('approved');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO compliance_profiles'),
      expect.any(Array),
    );
  });

  it('rejects a confirmed sanctions match and records the decision', async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: {
            data: { id: 43, hits: [{ types: ['sanction'], match_status: 'true_positive' }] },
          },
        }),
        { status: 200 },
      ),
    );

    const result = await complianceService.screenApplicant({
      subjectId: 'GTEST',
      firstName: 'Test',
      lastName: 'Person',
      countryCode: 'NG',
    });

    expect(result.status).toBe('rejected');
    expect(result.sanctions).toBe(true);
  });

  it('detects structuring and generates a SAR case', async () => {
    process.env.KYC_ENFORCEMENT_ENABLED = 'true';
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes('FROM compliance_profiles'))
        return { rows: [{ status: 'approved', country_code: 'NG' }], rowCount: 1 };
      if (text.includes('FROM remittances'))
        return { rows: [{ count_24h: 3, amount_24h: 5000, near_threshold_count: 2 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });

    const result = await complianceService.monitorTransaction({
      subjectId: 'GTEST',
      recipientAddress: 'GRECIPIENT',
      amount: 9000,
      transactionReference: '00000000-0000-4000-8000-000000000001',
    });

    expect(result.allowed).toBe(false);
    expect(result.ruleCodes).toContain('STRUCTURING');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sar_reports'),
      expect.any(Array),
    );
  });
});
