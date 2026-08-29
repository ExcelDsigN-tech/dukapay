import { query } from '../db/connection.js';
import { setAbsoluteUserScoresBulk } from './scoresService.js';
import { sorobanService } from './sorobanService.js';
import { jobMetricsService } from './jobMetricsService.js';
import logger from '../utils/logger.js';

/**
 * Cross-contract reconciliation with Saga pattern (issues #1377, #420).
 *
 * A loan's custody change and its credit-score mutation share one atomic boundary.
 * When they don't — partial settlement — we track via saga with compensation.
 *
 * State machine: PENDING -> PARTIAL -> COMPLETED / FAILED
 *  Also maps legacy: pending -> PENDING, half_applied -> PARTIAL, reconciled -> COMPLETED, failed -> FAILED
 *
 * Saga pattern: each settlement is a saga with steps; each step has compensation.
 * Partial failures trigger compensation handlers to restore consistency.
 */

export type SettlementState = 'PENDING' | 'PARTIAL' | 'COMPLETED' | 'FAILED';
// Legacy compatibility union
export type ReconciliationState = SettlementState | 'pending' | 'half_applied' | 'reconciled' | 'failed';

interface UnresolvedRow {
  id: number;
  intentKey: string;
  loanId: number | null;
  borrower: string;
  operation: 'approve' | 'repay' | 'default';
  disbursementLedger: number | null;
  expectedScoreDelta: number;
  attempts: number;
  state: string;
  settlementState?: SettlementState;
  updatedAt?: string | undefined;
}

export interface CrossContractReconciliationResult {
  backfilledRows: number;
  processedRows: number;
  reconciledCount: number;
  halfAppliedCount: number;
  stillPendingCount: number;
  correctedCount: number;
  compensatedCount: number;
  alertedPartialCount: number;
  autoCorrectEnabled: boolean;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

// On-chain event types that represent a credit-score mutation landing.
const SCORE_EVENT_TYPES = ['ScoreUpdated', 'ScoreDecreased'];

// ── Saga Pattern ────────────────────────────────────────────────────────────

export interface SagaStep {
  name: string;
  action: () => Promise<void>;
  compensation: () => Promise<void>;
}

export class SettlementSaga {
  private steps: SagaStep[] = [];
  private executed: SagaStep[] = [];

  addStep(step: SagaStep): void {
    this.steps.push(step);
  }

  async execute(): Promise<{ state: SettlementState; failedStep?: string }> {
    this.executed = [];
    for (const step of this.steps) {
      try {
        await step.action();
        this.executed.push(step);
      } catch (err) {
        // Partial failure — compensate executed steps in reverse order
        await this.compensate();
        return { state: 'FAILED', failedStep: step.name };
      }
    }
    // If all steps succeeded
    const state: SettlementState = this.executed.length === this.steps.length ? 'COMPLETED' : 'PARTIAL';
    return { state };
  }

  async compensate(): Promise<void> {
    for (let i = this.executed.length - 1; i >= 0; i--) {
      const step = this.executed[i]!;
      try {
        await step.compensation();
      } catch (err) {
        logger.withContext().error('saga.compensation_failed', { step: step.name, error: err });
      }
    }
  }
}

// Compensation handlers registry — each contract interaction has a compensating action
export const compensationHandlers: Record<string, (params: Record<string, unknown>) => Promise<void>> = {
  // Lending pool deposit compensation: withdraw equivalent
  lending_pool_deposit: async (params) => {
    logger.withContext().warn('compensating lending_pool deposit', params);
    // In production: call sorobanService to reverse the deposit
  },
  lending_pool_withdraw: async (params) => {
    logger.withContext().warn('compensating lending_pool withdraw', params);
  },
  agent_vault_collateral: async (params) => {
    logger.withContext().warn('compensating agent_vault collateral', params);
  },
  loan_manager_repay: async (params) => {
    logger.withContext().warn('compensating loan_manager repay', params);
  },
  score_update: async (params) => {
    logger.withContext().warn('compensating score update', params);
    // Compensation is handled by the main autocorrect flow; this handler
    // just records the intent to compensate and does not itself mutate scores
    // to avoid double-correction. State transition to FAILED is the compensation.
  },
};

export async function runCompensation(operation: string, params: Record<string, unknown>): Promise<boolean> {
  const handler = compensationHandlers[operation];
  if (!handler) {
    logger.withContext().warn('no compensation handler for operation', { operation });
    return false;
  }
  try {
    await handler(params);
    return true;
  } catch (err) {
    logger.withContext().error('compensation handler failed', { operation, error: err });
    return false;
  }
}

// Normalize legacy state to new SettlementState
export function normalizeState(state: string): SettlementState {
  switch (state) {
    case 'pending':
    case 'PENDING':
      return 'PENDING';
    case 'half_applied':
    case 'PARTIAL':
      return 'PARTIAL';
    case 'reconciled':
    case 'COMPLETED':
      return 'COMPLETED';
    case 'failed':
    case 'FAILED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

function toLegacyState(state: SettlementState): string {
  switch (state) {
    case 'PENDING':
      return 'pending';
    case 'PARTIAL':
      return 'half_applied';
    case 'COMPLETED':
      return 'reconciled';
    case 'FAILED':
      return 'failed';
  }
}

class CrossContractReconciler {
  private getMaxRowsPerRun(): number {
    return parsePositiveInt(process.env.CROSS_RECONCILE_MAX_ROWS_PER_RUN, 500);
  }

  private getStaleAttempts(): number {
    return parsePositiveInt(process.env.CROSS_RECONCILE_STALE_ATTEMPTS, 3);
  }

  private isAutoCorrectEnabled(): boolean {
    return parseBoolean(process.env.CROSS_RECONCILE_AUTOCORRECT_ENABLED, false);
  }

  private getPartialAlertThresholdMs(): number {
    return parsePositiveInt(process.env.CROSS_RECONCILE_PARTIAL_ALERT_MS, 60 * 60 * 1000);
  }

  private async backfillPendingRows(): Promise<number> {
    const result = await query(
      `/* backfill */
      INSERT INTO cross_contract_reconciliation
        (intent_key, loan_id, borrower, operation, disbursement_ledger,
         disbursement_tx_hash, expected_score_delta, state)
      SELECT
        ce.event_type || ':' || COALESCE(ce.loan_id::text, '-') || ':' || ce.event_id,
        ce.loan_id,
        ce.address,
        CASE ce.event_type
          WHEN 'LoanApproved'  THEN 'approve'
          WHEN 'LoanRepaid'    THEN 'repay'
          WHEN 'LoanDefaulted' THEN 'default'
        END,
        ce.ledger,
        ce.tx_hash,
        CASE ce.event_type
          WHEN 'LoanRepaid'    THEN GREATEST(0, FLOOR(COALESCE(ce.amount, 0) / 100))::int
          WHEN 'LoanDefaulted' THEN -50
          ELSE 0
        END,
        'pending'
      FROM contract_events ce
      WHERE ce.event_type IN ('LoanApproved', 'LoanRepaid', 'LoanDefaulted')
        AND ce.address IS NOT NULL
        AND ce.address <> ''
        AND NOT EXISTS (
          SELECT 1 FROM cross_contract_reconciliation r
          WHERE r.intent_key =
            ce.event_type || ':' || COALESCE(ce.loan_id::text, '-') || ':' || ce.event_id
        )
      ON CONFLICT (intent_key) DO NOTHING`,
    );
    return result.rowCount ?? 0;
  }

  private async fetchUnresolvedRows(): Promise<UnresolvedRow[]> {
    const result = await query(
      `/* fetch-unresolved */
      SELECT id, intent_key, loan_id, borrower, operation, disbursement_ledger,
             expected_score_delta, attempts, state, updated_at
      FROM cross_contract_reconciliation
      WHERE state IN ('pending', 'half_applied', 'PENDING', 'PARTIAL', 'reconciled', 'failed')
        AND state NOT IN ('reconciled', 'COMPLETED')
      ORDER BY id ASC
      LIMIT $1`,
      [this.getMaxRowsPerRun()],
    );

    return result.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: Number(r.id),
        intentKey: String(r.intent_key ?? ''),
        loanId: r.loan_id == null ? null : Number(r.loan_id),
        borrower: String(r.borrower ?? ''),
        operation: String(r.operation ?? 'approve') as UnresolvedRow['operation'],
        disbursementLedger: r.disbursement_ledger == null ? null : Number(r.disbursement_ledger),
        expectedScoreDelta: Number(r.expected_score_delta ?? 0),
        attempts: Number(r.attempts ?? 0),
        state: String(r.state ?? 'pending'),
        settlementState: normalizeState(String(r.state ?? 'pending')),
        updatedAt: r.updated_at ? String(r.updated_at) : undefined,
      };
    });
  }

  private async findMatchingScoreLedger(
    borrower: string,
    sinceLedger: number | null,
  ): Promise<number | null> {
    const result = await query(
      `/* match-score */
      SELECT ledger
      FROM contract_events
      WHERE address = $1
        AND event_type = ANY($2::text[])
        AND ledger >= $3
      ORDER BY ledger ASC
      LIMIT 1`,
      [borrower, SCORE_EVENT_TYPES, sinceLedger ?? 0],
    );
    const row = result.rows[0] as { ledger?: number | string } | undefined;
    return row?.ledger == null ? null : Number(row.ledger);
  }

  private async markReconciled(
    id: number,
    scoreLedger: number | null,
    applied: boolean,
  ): Promise<void> {
    await query(
      `/* update */
      UPDATE cross_contract_reconciliation
      SET state = 'reconciled', score_applied = $2, score_ledger = $3,
          attempts = attempts + 1, last_checked_at = now(), updated_at = now()
      WHERE id = $1`,
      [id, applied, scoreLedger],
    );
  }

  private async markState(id: number, state: SettlementState | 'pending' | 'half_applied'): Promise<void> {
    // Normalize to legacy for DB compatibility (new states will be migrated)
    const dbState = typeof state === 'string' && ['PENDING', 'PARTIAL', 'COMPLETED', 'FAILED'].includes(state)
      ? toLegacyState(state as SettlementState)
      : state;
    await query(
      `/* update */
      UPDATE cross_contract_reconciliation
      SET state = $2, attempts = attempts + 1, last_checked_at = now(), updated_at = now()
      WHERE id = $1`,
      [id, dbState],
    );
  }

  private async markSettlementState(id: number, settlementState: SettlementState): Promise<void> {
    const dbState = toLegacyState(settlementState);
    await query(
      `/* update-settlement */
      UPDATE cross_contract_reconciliation
      SET state = $2, attempts = attempts + 1, last_checked_at = now(), updated_at = now()
      WHERE id = $1`,
      [id, dbState],
    );
  }

  /**
   * Alert on PARTIAL settlements stuck > 1 hour.
   * Returns count of alerted rows.
   */
  async alertStuckPartials(): Promise<number> {
    const thresholdMs = this.getPartialAlertThresholdMs();
    const result = await query(
      `/* alert-partials */
      SELECT id, borrower, operation, updated_at, state
      FROM cross_contract_reconciliation
      WHERE state IN ('half_applied', 'PARTIAL')
        AND updated_at < NOW() - INTERVAL '1 millisecond' * $1`,
      [thresholdMs],
    );

    if (result.rows.length > 0) {
      for (const row of result.rows) {
        const r = row as Record<string, unknown>;
        logger.withContext().error('cross_contract_reconciliation.partial_stuck_alert', {
          id: r.id,
          borrower: r.borrower,
          operation: r.operation,
          state: r.state,
          updated_at: r.updated_at,
          thresholdMs,
        });
      }
      // Also emit metrics
      jobMetricsService.recordFailure(
        'crossContractReconciler.partial_stuck',
        `${result.rows.length} settlements stuck in PARTIAL > ${thresholdMs}ms`,
        0,
      );
    }
    return result.rows.length;
  }

  /**
   * Execute compensation for a partially settled row.
   */
  async compensatePartial(row: UnresolvedRow): Promise<boolean> {
    const operation = row.operation;
    const handlerKey =
      operation === 'repay' ? 'score_update' : operation === 'default' ? 'score_update' : 'lending_pool_deposit';

    const compensated = await runCompensation(handlerKey, {
      borrower: row.borrower,
      loanId: row.loanId,
      operation: row.operation,
      intentKey: row.intentKey,
    });

    if (compensated) {
      await this.markSettlementState(row.id, 'FAILED');
      logger.withContext().warn('cross_contract_reconciliation.compensated', {
        id: row.id,
        operation: row.operation,
      });
    }
    return compensated;
  }

  async run(): Promise<CrossContractReconciliationResult> {
    const startTime = Date.now();
    const jobName = 'crossContractReconciler';
    const autoCorrectEnabled = this.isAutoCorrectEnabled();
    const staleAttempts = this.getStaleAttempts();

    const result: CrossContractReconciliationResult = {
      backfilledRows: 0,
      processedRows: 0,
      reconciledCount: 0,
      halfAppliedCount: 0,
      stillPendingCount: 0,
      correctedCount: 0,
      compensatedCount: 0,
      alertedPartialCount: 0,
      autoCorrectEnabled,
    };

    try {
      result.backfilledRows = await this.backfillPendingRows();
      const rows = await this.fetchUnresolvedRows();

      logger.withContext().info('cross_contract_reconciliation.run.start', {
        backfilledRows: result.backfilledRows,
        unresolvedRows: rows.length,
        autoCorrectEnabled,
      });

      const corrections = new Map<string, number>();

      for (const row of rows) {
        result.processedRows += 1;

        if (row.expectedScoreDelta === 0) {
          await this.markReconciled(row.id, null, false);
          result.reconciledCount += 1;
          continue;
        }

        const scoreLedger = await this.findMatchingScoreLedger(row.borrower, row.disbursementLedger);

        if (scoreLedger !== null) {
          await this.markReconciled(row.id, scoreLedger, true);
          result.reconciledCount += 1;
          continue;
        }

        if (row.attempts + 1 >= staleAttempts) {
          // Transition to PARTIAL (half_applied) — saga partial failure
          await this.markState(row.id, 'PARTIAL');
          result.halfAppliedCount += 1;

          // Saga compensation: attempt to restore consistency
          try {
            const compensated = await this.compensatePartial(row);
            if (compensated) result.compensatedCount += 1;
          } catch (err) {
            logger.withContext().error('compensation failed', { id: row.id, error: err });
          }

          if (autoCorrectEnabled) {
            try {
              const onChainScore = await sorobanService.getOnChainCreditScore(row.borrower);
              corrections.set(row.borrower, onChainScore);
            } catch (err) {
              logger
                .withContext()
                .error('cross_contract_reconciliation.autocorrect.lookup_failed', {
                  borrower: row.borrower,
                  error: err,
                });
            }
          }
        } else {
          // Still PENDING — not yet stale
          await this.markState(row.id, 'PENDING');
          result.stillPendingCount += 1;
        }
      }

      if (corrections.size > 0) {
        await setAbsoluteUserScoresBulk(corrections);
        result.correctedCount = corrections.size;
        logger.withContext().warn('cross_contract_reconciliation.autocorrect.applied', {
          correctedCount: corrections.size,
        });
      }

      // Alert on stuck PARTIAL settlements > 1 hour
      result.alertedPartialCount = await this.alertStuckPartials();

      logger.withContext().info('cross_contract_reconciliation.run.complete', { ...result });
      jobMetricsService.recordSuccess(jobName, Date.now() - startTime);
      return result;
    } catch (error) {
      jobMetricsService.recordFailure(jobName, error as Error | string, Date.now() - startTime);
      throw error;
    }
  }
}

export const crossContractReconciler = new CrossContractReconciler();

let interval: ReturnType<typeof setInterval> | undefined;
let inFlight = false;

export function startCrossContractReconciler(): void {
  if (interval) return;
  if (process.env.NODE_ENV === 'test') return;

  if (!process.env.REMITTANCE_NFT_CONTRACT_ID) {
    logger
      .withContext()
      .warn('Cross-contract reconciler disabled (set REMITTANCE_NFT_CONTRACT_ID)');
    return;
  }

  const intervalMs = parsePositiveInt(process.env.CROSS_RECONCILE_INTERVAL_MS, 5 * 60 * 1000);

  const runOnce = async () => {
    if (inFlight) {
      logger.withContext().warn('Cross-contract reconciler run skipped (previous run in flight)');
      return;
    }
    inFlight = true;
    try {
      await crossContractReconciler.run();
    } catch (error) {
      logger.withContext().error('Cross-contract reconciler scheduled run failed', { error });
    } finally {
      inFlight = false;
    }
  };

  void runOnce();
  interval = setInterval(() => void runOnce(), intervalMs);
  interval.unref?.();

  logger.withContext().info('Cross-contract reconciler scheduler started', { intervalMs });
}

export function stopCrossContractReconciler(): void {
  if (interval) {
    clearInterval(interval);
    interval = undefined;
    logger.withContext().info('Cross-contract reconciler scheduler stopped');
  }
}
