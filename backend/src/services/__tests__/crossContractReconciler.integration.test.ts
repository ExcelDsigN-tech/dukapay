import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number };
const mockQuery = jest.fn<(sql: string, params?: unknown[]) => Promise<QueryResult>>();
const mockSetAbsoluteUserScoresBulk = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockGetOnChainCreditScore = jest.fn<() => Promise<number>>().mockResolvedValue(700);
const mockRecordSuccess = jest.fn();
const mockRecordFailure = jest.fn();

jest.unstable_mockModule('../../db/connection.js', () => ({ query: mockQuery }));
jest.unstable_mockModule('../scoresService.js', () => ({
  setAbsoluteUserScoresBulk: mockSetAbsoluteUserScoresBulk,
}));
jest.unstable_mockModule('../sorobanService.js', () => ({
  sorobanService: { getOnChainCreditScore: mockGetOnChainCreditScore },
}));
jest.unstable_mockModule('../jobMetricsService.js', () => ({
  jobMetricsService: { recordSuccess: mockRecordSuccess, recordFailure: mockRecordFailure },
}));

const { crossContractReconciler, SettlementSaga, compensationHandlers, normalizeState } = await import(
  '../crossContractReconciler.js'
);

function routeQueries(opts: {
  backfilled?: number;
  unresolved?: Record<string, unknown>[];
  matchByBorrower?: Record<string, number>;
  partialRows?: Record<string, unknown>[];
}) {
  const { backfilled = 0, unresolved = [], matchByBorrower = {}, partialRows = [] } = opts;
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes('/* backfill */')) return { rows: [], rowCount: backfilled };
    if (sql.includes('/* fetch-unresolved */'))
      return { rows: unresolved, rowCount: unresolved.length };
    if (sql.includes('/* match-score */')) {
      const borrower = String(params?.[0] ?? '');
      const ledger = matchByBorrower[borrower];
      return ledger != null ? { rows: [{ ledger }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes('/* alert-partials */')) return { rows: partialRows, rowCount: partialRows.length };
    if (sql.includes('/* update')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
}

function row(over: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: 1,
    intent_key: 'LoanRepaid:1:evt-1',
    loan_id: 1,
    borrower: 'GB...ABC',
    operation: 'repay',
    disbursement_ledger: 1000,
    expected_score_delta: 5,
    attempts: 0,
    state: 'pending',
    updated_at: new Date().toISOString(),
    ...over,
  };
}

describe('crossContractReconciler saga & partial settlement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CROSS_RECONCILE_AUTOCORRECT_ENABLED;
    delete process.env.CROSS_RECONCILE_STALE_ATTEMPTS;
    routeQueries({});
  });

  it('transitions PENDING -> PARTIAL on stale attempts and triggers compensation', async () => {
    process.env.CROSS_RECONCILE_STALE_ATTEMPTS = '1';
    routeQueries({
      unresolved: [row({ attempts: 0 })],
      matchByBorrower: {},
      partialRows: [],
    });
    const result = await crossContractReconciler.run();
    expect(result.halfAppliedCount).toBe(1);
    expect(result.compensatedCount).toBe(1);
    // DB should have been updated to half_applied/PARTIAL
    const updateCalls = mockQuery.mock.calls.filter(([sql]) => sql.includes('/* update'));
    expect(updateCalls.length).toBeGreaterThan(0);
  });

  it('alerts on PARTIAL settlements stuck > 1 hour', async () => {
    const stuckRow = {
      id: 99,
      borrower: 'GB...STUCK',
      operation: 'repay',
      state: 'half_applied',
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    };
    routeQueries({
      unresolved: [],
      partialRows: [stuckRow],
    });
    const alerted = await crossContractReconciler.alertStuckPartials();
    expect(alerted).toBe(1);
    expect(mockRecordFailure).toHaveBeenCalledWith(
      'crossContractReconciler.partial_stuck',
      expect.stringContaining('1 settlements'),
      0,
    );
  });

  it('does not alert when no stuck partials', async () => {
    routeQueries({ unresolved: [], partialRows: [] });
    const alerted = await crossContractReconciler.alertStuckPartials();
    expect(alerted).toBe(0);
  });

  it('saga executes all steps and returns COMPLETED', async () => {
    const saga = new SettlementSaga();
    const order: string[] = [];
    saga.addStep({
      name: 'step1',
      action: async () => order.push('action1'),
      compensation: async () => order.push('comp1'),
    });
    saga.addStep({
      name: 'step2',
      action: async () => order.push('action2'),
      compensation: async () => order.push('comp2'),
    });
    const result = await saga.execute();
    expect(result.state).toBe('COMPLETED');
    expect(order).toEqual(['action1', 'action2']);
  });

  it('saga compensates on partial failure and returns FAILED', async () => {
    const saga = new SettlementSaga();
    const order: string[] = [];
    saga.addStep({
      name: 'step1',
      action: async () => order.push('action1'),
      compensation: async () => order.push('comp1'),
    });
    saga.addStep({
      name: 'step2',
      action: async () => {
        throw new Error('step2 failed');
      },
      compensation: async () => order.push('comp2'),
    });
    saga.addStep({
      name: 'step3',
      action: async () => order.push('action3'),
      compensation: async () => order.push('comp3'),
    });
    const result = await saga.execute();
    expect(result.state).toBe('FAILED');
    expect(result.failedStep).toBe('step2');
    expect(order).toEqual(['action1', 'comp1']);
    // step3 never executed
    expect(order).not.toContain('action3');
  });

  it('compensation handlers exist for each contract interaction', async () => {
    expect(compensationHandlers['lending_pool_deposit']).toBeDefined();
    expect(compensationHandlers['lending_pool_withdraw']).toBeDefined();
    expect(compensationHandlers['agent_vault_collateral']).toBeDefined();
    expect(compensationHandlers['loan_manager_repay']).toBeDefined();
    expect(compensationHandlers['score_update']).toBeDefined();
  });

  it('normalizeState maps legacy states correctly', () => {
    expect(normalizeState('pending')).toBe('PENDING');
    expect(normalizeState('half_applied')).toBe('PARTIAL');
    expect(normalizeState('reconciled')).toBe('COMPLETED');
    expect(normalizeState('failed')).toBe('FAILED');
    expect(normalizeState('PENDING')).toBe('PENDING');
    expect(normalizeState('PARTIAL')).toBe('PARTIAL');
  });

  it('partial failure scenario triggers state PARTIAL and compensation per contract', async () => {
    process.env.CROSS_RECONCILE_STALE_ATTEMPTS = '1';
    const repayRow = row({ id: 10, borrower: 'GB...REPAY', operation: 'repay', expected_score_delta: 5 });
    const defaultRow = row({ id: 11, borrower: 'GB...DEFAULT', operation: 'default', expected_score_delta: -50 });
    routeQueries({
      unresolved: [repayRow, defaultRow],
      matchByBorrower: {},
      partialRows: [],
    });
    const result = await crossContractReconciler.run();
    expect(result.halfAppliedCount).toBe(2);
    expect(result.compensatedCount).toBe(2);
  });
});
