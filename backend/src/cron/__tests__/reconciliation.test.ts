import { describe, it, expect, beforeEach, beforeAll, jest } from '@jest/globals';

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetLoanDetails = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockGetAgentVaultDetails = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../../services/sorobanService.js', () => ({
  sorobanService: {
    getLoanDetails: mockGetLoanDetails,
    getAgentVaultDetails: mockGetAgentVaultDetails,
  },
}));

let runReconciliationPass: typeof import('../reconciliation.js').runReconciliationPass;

beforeAll(async () => {
  const mod = await import('../reconciliation.js');
  runReconciliationPass = mod.runReconciliationPass;
});

describe('State Synchronization & Automated Reconciliation', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetLoanDetails.mockReset();
    mockGetAgentVaultDetails.mockReset();
  });

  it('runs reconciliation pass cleanly when DB and contract state match', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never);

    const result = await runReconciliationPass();
    expect(result.status).toBe('SUCCESS');
    expect(result.discrepanciesCount).toBe(0);
    expect(result.majorAlertsCount).toBe(0);
  });

  it('detects minor drift and auto-corrects DB balance', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never) // ensure table
      .mockResolvedValueOnce({
        rows: [{ loan_id: '1', borrower: 'GBORROWER', amount: '500', status: 'active' }],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never) // agents
      .mockResolvedValue({ rows: [] } as never); // update/insert log

    mockGetLoanDetails.mockResolvedValue({
      amount: '505',
    } as never);

    const result = await runReconciliationPass();
    expect(result.discrepanciesCount).toBe(1);
    expect(result.discrepancies[0].autoCorrected).toBe(true);
    expect(result.autoCorrectedCount).toBe(1);
  });

  it('detects major drift (> $100) and triggers major alert without auto-correction', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({
        rows: [{ loan_id: '1', borrower: 'GBORROWER', amount: '500', status: 'active' }],
      } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValue({ rows: [] } as never);

    mockGetLoanDetails.mockResolvedValue({
      amount: '750',
    } as never);

    const result = await runReconciliationPass();
    expect(result.status).toBe('ALERT');
    expect(result.majorAlertsCount).toBe(1);
    expect(result.discrepancies[0].isMajor).toBe(true);
    expect(result.discrepancies[0].autoCorrected).toBe(false);
  });
});
