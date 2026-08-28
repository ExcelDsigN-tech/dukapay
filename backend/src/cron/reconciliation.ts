import cron from 'node-cron';
import { query, withTransaction } from '../db/connection.js';
import { sorobanService } from '../services/sorobanService.js';
import { cacheService } from '../services/cacheService.js';
import logger from '../utils/logger.js';

export interface ReconciliationDiscrepancy {
  entityType: 'loan_balance' | 'float_balance' | 'collateral_ratio' | 'agent_status';
  entityId: string;
  onChainValue: number | string | boolean;
  dbValue: number | string | boolean;
  diffAmount: number;
  diffPercent: number;
  isMajor: boolean; // > $100 or > 1%
  autoCorrected: boolean;
}

export interface ReconciliationRunResult {
  runId: string;
  timestamp: string;
  totalChecked: number;
  discrepanciesCount: number;
  majorAlertsCount: number;
  autoCorrectedCount: number;
  discrepancies: ReconciliationDiscrepancy[];
  status: 'SUCCESS' | 'WARNING' | 'ALERT';
}

const DRIFT_ALERT_AMOUNT_THRESHOLD = 100; // $100
const DRIFT_ALERT_PERCENT_THRESHOLD = 0.01; // 1%

/**
 * Ensures the reconciliation_logs table exists.
 */
export async function ensureReconciliationTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS reconciliation_logs (
      id SERIAL PRIMARY KEY,
      run_id VARCHAR(64) NOT NULL,
      timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      total_checked INT NOT NULL,
      discrepancies_count INT NOT NULL,
      major_alerts_count INT NOT NULL,
      auto_corrected_count INT NOT NULL,
      status VARCHAR(32) NOT NULL,
      details JSONB
    )
  `).catch((err) => {
    logger.withContext().error('Failed to ensure reconciliation_logs table', { error: err });
  });
}

/**
 * Executes a full reconciliation pass between on-chain contract state and indexer DB state.
 */
export async function runReconciliationPass(): Promise<ReconciliationRunResult> {
  const runId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const timestamp = new Date().toISOString();
  const discrepancies: ReconciliationDiscrepancy[] = [];
  let totalChecked = 0;
  let autoCorrectedCount = 0;

  logger.withContext().info('Starting state reconciliation pass', { runId });

  try {
    await ensureReconciliationTable();

    // 1. Reconcile Active Loans (loan balances)
    const activeLoansResult = await query(`
      SELECT loan_id, borrower, amount, status 
      FROM loans 
      WHERE status = 'active'
    `).catch(() => ({ rows: [] }));

    for (const loan of activeLoansResult.rows) {
      totalChecked++;
      const loanId = parseInt(loan.loan_id, 10);
      try {
        const onChainLoan = await sorobanService.getLoanDetails(loanId);
        if (onChainLoan) {
          const dbAmount = parseFloat(loan.amount || '0');
          const onChainAmount = parseFloat(onChainLoan.amount || '0');
          const diffAmount = Math.abs(dbAmount - onChainAmount);
          const maxVal = Math.max(dbAmount, onChainAmount, 1);
          const diffPercent = diffAmount / maxVal;

          if (diffAmount > 0.01) {
            const isMajor = diffAmount > DRIFT_ALERT_AMOUNT_THRESHOLD || diffPercent > DRIFT_ALERT_PERCENT_THRESHOLD;
            let autoCorrected = false;

            if (!isMajor) {
              // Auto-correct minor drift in DB
              await query(`UPDATE loans SET amount = $1, updated_at = CURRENT_TIMESTAMP WHERE loan_id = $2`, [onChainAmount, loanId]);
              autoCorrected = true;
              autoCorrectedCount++;
            }

            discrepancies.push({
              entityType: 'loan_balance',
              entityId: String(loanId),
              onChainValue: onChainAmount,
              dbValue: dbAmount,
              diffAmount,
              diffPercent,
              isMajor,
              autoCorrected,
            });
          }
        }
      } catch (e) {
        logger.withContext().warn(`Reconciliation check failed for loan ${loanId}`, { error: e });
      }
    }

    // 2. Reconcile Agent Float Balances & Statuses
    const agentsResult = await query(`
      SELECT agent_address, float_balance, collateral_balance, is_active 
      FROM agent_vaults
    `).catch(() => ({ rows: [] }));

    for (const agent of agentsResult.rows) {
      totalChecked++;
      const agentAddress = agent.agent_address;
      try {
        const onChainVault = await sorobanService.getAgentVaultDetails(agentAddress);
        if (onChainVault) {
          const dbFloat = parseFloat(agent.float_balance || '0');
          const onChainFloat = parseFloat(onChainVault.floatBalance || '0');
          const diffFloat = Math.abs(dbFloat - onChainFloat);
          const maxFloat = Math.max(dbFloat, onChainFloat, 1);
          const diffPercent = diffFloat / maxFloat;

          if (diffFloat > 0.01) {
            const isMajor = diffFloat > DRIFT_ALERT_AMOUNT_THRESHOLD || diffPercent > DRIFT_ALERT_PERCENT_THRESHOLD;
            let autoCorrected = false;

            if (!isMajor) {
              await query(`UPDATE agent_vaults SET float_balance = $1, updated_at = CURRENT_TIMESTAMP WHERE agent_address = $2`, [onChainFloat, agentAddress]);
              await cacheService.delete(`agent:dashboard:${agentAddress}`);
              autoCorrected = true;
              autoCorrectedCount++;
            }

            discrepancies.push({
              entityType: 'float_balance',
              entityId: agentAddress,
              onChainValue: onChainFloat,
              dbValue: dbFloat,
              diffAmount: diffFloat,
              diffPercent,
              isMajor,
              autoCorrected,
            });
          }

          // Check Agent Active Status
          if (agent.is_active !== onChainVault.isActive) {
            await query(`UPDATE agent_vaults SET is_active = $1 WHERE agent_address = $2`, [onChainVault.isActive, agentAddress]);
            autoCorrectedCount++;
            discrepancies.push({
              entityType: 'agent_status',
              entityId: agentAddress,
              onChainValue: onChainVault.isActive,
              dbValue: agent.is_active,
              diffAmount: 0,
              diffPercent: 0,
              isMajor: true,
              autoCorrected: true,
            });
          }
        }
      } catch (e) {
        logger.withContext().warn(`Reconciliation check failed for agent ${agentAddress}`, { error: e });
      }
    }

    const majorAlertsCount = discrepancies.filter((d) => d.isMajor && !d.autoCorrected).length;
    const status: ReconciliationRunResult['status'] = majorAlertsCount > 0 ? 'ALERT' : discrepancies.length > 0 ? 'WARNING' : 'SUCCESS';

    if (majorAlertsCount > 0) {
      logger.withContext().error(`[DRIFT ALERT] State reconciliation detected ${majorAlertsCount} major discrepancies!`, {
        runId,
        majorAlertsCount,
        discrepancies,
      });
    }

    const runResult: ReconciliationRunResult = {
      runId,
      timestamp,
      totalChecked,
      discrepanciesCount: discrepancies.length,
      majorAlertsCount,
      autoCorrectedCount,
      discrepancies,
      status,
    };

    // Store log entry in database
    await query(
      `INSERT INTO reconciliation_logs (run_id, total_checked, discrepancies_count, major_alerts_count, auto_corrected_count, status, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [runId, totalChecked, discrepancies.length, majorAlertsCount, autoCorrectedCount, status, JSON.stringify(runResult)],
    ).catch(() => {});

    return runResult;
  } catch (error) {
    logger.withContext().error('Reconciliation pass failed', { error });
    return {
      runId,
      timestamp,
      totalChecked,
      discrepanciesCount: discrepancies.length,
      majorAlertsCount: 0,
      autoCorrectedCount,
      discrepancies,
      status: 'ALERT',
    };
  }
}

/**
 * Returns latest reconciliation logs and status dashboard info.
 */
export async function getReconciliationStatus(): Promise<ReconciliationRunResult | null> {
  const result = await query(`
    SELECT details FROM reconciliation_logs 
    ORDER BY id DESC 
    LIMIT 1
  `).catch(() => ({ rows: [] }));

  if (result.rows.length > 0) {
    return result.rows[0].details as ReconciliationRunResult;
  }
  return null;
}

/**
 * Schedule hourly cron job: "0 * * * *"
 */
export function startReconciliationCron(): cron.ScheduledTask {
  logger.withContext().info('Scheduling hourly automated reconciliation job (0 * * * *)');
  return cron.schedule('0 * * * *', async () => {
    await runReconciliationPass();
  });
}
