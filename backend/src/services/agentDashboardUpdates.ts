import { pubsubService } from './pubsubService.js';
import { cacheService } from './cacheService.js';
import { query } from '../db/connection.js';
import logger from '../utils/logger.js';

const AGENT_DASHBOARD_PUBLISH_INTERVAL_MS = 10_000;

interface AgentDashboardSummary {
  agentPublicKey: string;
  floatUtilization: {
    totalFloat: number;
    allocated: number;
    utilizationPct: number;
  };
  earnings: {
    daily: number;
    weekly: number;
    monthly: number;
    total: number;
  };
  borrowerPortfolio: {
    totalLoans: number;
    activeLoans: number;
    defaultedLoans: number;
  };
  timestamp: string;
}

async function fetchAgentDashboardSummary(
  agentPublicKey: string,
): Promise<AgentDashboardSummary | null> {
  try {
    const cacheKey = `agent:dashboard:${agentPublicKey}`;
    const cached = await cacheService.get<AgentDashboardSummary>(cacheKey);
    if (cached) {
      return { ...cached, timestamp: new Date().toISOString() };
    }

    const [floatResult, earningsResult, portfolioResult] = await Promise.all([
      query(
        `SELECT
           COALESCE(SUM(CASE WHEN event_type = 'Deposit' THEN amount ELSE 0 END), 0) as total_float,
           COALESCE(SUM(CASE WHEN event_type = 'Withdraw' THEN amount ELSE 0 END), 0) as total_withdrawn
         FROM contract_events
         WHERE address = $1 AND event_type IN ('Deposit', 'Withdraw')`,
        [agentPublicKey],
      ),
      query(
        `SELECT
           COALESCE(SUM(CASE
             WHEN event_type = 'LoanRepaid' AND created_at >= NOW() - INTERVAL '1 day' THEN amount * 0.005 ELSE 0
           END), 0) as daily,
           COALESCE(SUM(CASE
             WHEN event_type = 'LoanRepaid' AND created_at >= NOW() - INTERVAL '7 days' THEN amount * 0.005 ELSE 0
           END), 0) as weekly,
           COALESCE(SUM(CASE
             WHEN event_type = 'LoanRepaid' AND created_at >= NOW() - INTERVAL '30 days' THEN amount * 0.005 ELSE 0
           END), 0) as monthly
         FROM contract_events
         WHERE address = $1 AND event_type = 'LoanRepaid'`,
        [agentPublicKey],
      ),
      query(
        `SELECT
           COUNT(*) as total_loans,
           COUNT(CASE WHEN status = 'active' THEN 1 END) as active_loans,
           COUNT(CASE WHEN status = 'defaulted' THEN 1 END) as defaulted_loans
         FROM loans
         WHERE borrower_public_key = $1`,
        [agentPublicKey],
      ).catch(() => ({ rows: [{ total_loans: 0, active_loans: 0, defaulted_loans: 0 }] })),
    ]);

    const floatRow = floatResult.rows[0] as Record<string, unknown>;
    const earningsRow = earningsResult.rows[0] as Record<string, unknown>;
    const portfolioRow = portfolioResult.rows[0] as Record<string, unknown>;

    const totalFloat = Number(floatRow.total_float ?? 0);
    const allocated = Math.max(0, totalFloat - Number(floatRow.total_withdrawn ?? 0));

    return {
      agentPublicKey,
      floatUtilization: {
        totalFloat,
        allocated,
        utilizationPct: totalFloat > 0 ? (allocated / totalFloat) * 100 : 0,
      },
      earnings: {
        daily: Number(earningsRow.daily ?? 0),
        weekly: Number(earningsRow.weekly ?? 0),
        monthly: Number(earningsRow.monthly ?? 0),
        total:
          Number(earningsRow.daily ?? 0) +
          Number(earningsRow.weekly ?? 0) +
          Number(earningsRow.monthly ?? 0),
      },
      borrowerPortfolio: {
        totalLoans: Number(portfolioRow.total_loans ?? 0),
        activeLoans: Number(portfolioRow.active_loans ?? 0),
        defaultedLoans: Number(portfolioRow.defaulted_loans ?? 0),
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.withContext().error('Failed to fetch agent dashboard summary', {
      agentPublicKey,
      error,
    });
    return null;
  }
}

export async function publishAgentDashboardUpdates(): Promise<void> {
  try {
    const agentResult = await query(
      `SELECT DISTINCT public_key FROM user_profiles
       WHERE metadata->>'role' IN ('admin', 'agent', 'lender')
         AND metadata->>'is_suspended' IS DISTINCT FROM 'true'`,
    );

    const agentPublicKeys = agentResult.rows.map(
      (row) => (row as { public_key: string }).public_key,
    );

    let published = 0;
    for (const agentPublicKey of agentPublicKeys) {
      const summary = await fetchAgentDashboardSummary(agentPublicKey);
      if (summary) {
        await pubsubService.publish({
          type: 'agent_dashboard_update',
          agentPublicKey,
          data: summary,
        });
        published++;
      }
    }

    logger.withContext().info('Published agent dashboard updates', {
      agentCount: agentPublicKeys.length,
      published,
    });
  } catch (error) {
    logger.withContext().error('Failed to publish agent dashboard updates', { error });
  }
}

let interval: ReturnType<typeof setInterval> | undefined;

export function startAgentDashboardPublisher(): void {
  if (interval) return;
  if (process.env.NODE_ENV === 'test') return;

  void publishAgentDashboardUpdates();
  interval = setInterval(
    () => void publishAgentDashboardUpdates(),
    AGENT_DASHBOARD_PUBLISH_INTERVAL_MS,
  );
  interval.unref?.();

  logger.withContext().info('Agent dashboard publisher started', {
    intervalMs: AGENT_DASHBOARD_PUBLISH_INTERVAL_MS,
  });
}

export function stopAgentDashboardPublisher(): void {
  if (interval) {
    clearInterval(interval);
    interval = undefined;
    logger.withContext().info('Agent dashboard publisher stopped');
  }
}
