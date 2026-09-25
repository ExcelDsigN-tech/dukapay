import type { Request, Response } from 'express';
import { query } from '../db/connection.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { cacheService } from '../services/cacheService.js';

interface AgentDashboardData {
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
    totalOutstanding: number;
    byStatus: Record<string, number>;
  };
  pendingSettlements: {
    count: number;
    totalValue: number;
  };
  collateralRatio: {
    totalCollateral: number;
    totalDebt: number;
    ratio: number;
  };
  recentTransactions: Array<{
    type: string;
    amount: number;
    loanId: string | null;
    timestamp: string;
  }>;
}

const AGENT_DASHBOARD_CACHE_TTL = 30;

function formatNumber(value: string | number | null): number {
  if (value == null) return 0;
  const num = Number.parseFloat(typeof value === 'string' ? value : String(value));
  return Number.isFinite(num) ? num : 0;
}

export const getAgentDashboard = asyncHandler(async (req: Request, res: Response) => {
  const agentPublicKey = req.user?.publicKey;
  if (!agentPublicKey) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const cacheKey = `agent:dashboard:${agentPublicKey}`;
  const cached = await cacheService.get<AgentDashboardData>(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const [
    floatResult,
    earningsResult,
    portfolioResult,
    settlementsResult,
    collateralResult,
    transactionsResult,
  ] = await Promise.all([
    // Float utilization: total deposits allocated vs pool size
    query(
      `SELECT
         COALESCE(SUM(CASE WHEN event_type = 'Deposit' THEN amount ELSE 0 END), 0) as total_float,
         COALESCE(SUM(CASE WHEN event_type = 'Withdraw' THEN amount ELSE 0 END), 0) as total_withdrawn,
         COUNT(*) as deposit_count
       FROM contract_events
       WHERE address = $1 AND event_type IN ('Deposit', 'Withdraw')`,
      [agentPublicKey],
    ),
    // Earnings: fees and interest from loan events
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
         END), 0) as monthly,
         COALESCE(SUM(CASE
           WHEN event_type = 'LoanRepaid' THEN amount * 0.005 ELSE 0
         END), 0) as total
       FROM contract_events
       WHERE address = $1 AND event_type = 'LoanRepaid'`,
      [agentPublicKey],
    ),
    // Borrower portfolio
    query(
      `SELECT
         COUNT(*) as total_loans,
         COUNT(CASE WHEN status = 'active' THEN 1 END) as active_loans,
         COUNT(CASE WHEN status = 'defaulted' THEN 1 END) as defaulted_loans,
         COALESCE(SUM(CASE WHEN status IN ('active', 'pending') THEN principal ELSE 0 END), 0) as total_outstanding,
         COUNT(CASE WHEN status = 'active' THEN 1 END) FILTER (WHERE status IS NOT NULL) as active_for_group
       FROM loans
       WHERE borrower_public_key = $1`,
      [agentPublicKey],
    ).catch(() => ({ rows: [{}] })),
    // Pending settlements
    query(
      `SELECT
         COUNT(*) as settlement_count,
         COALESCE(SUM(amount), 0) as total_value
       FROM contract_events
       WHERE address = $1 AND event_type IN ('LoanDefaulted', 'CollateralLiquidated')
         AND created_at >= NOW() - INTERVAL '3 days'`,
      [agentPublicKey],
    ),
    // Collateral ratio
    query(
      `SELECT
         COALESCE(SUM(CASE WHEN event_type = 'CollateralDeposited' THEN amount ELSE 0 END), 0) as total_collateral,
         COALESCE(SUM(CASE
           WHEN event_type = 'LoanApproved' THEN amount
           WHEN event_type = 'LoanRepaid' THEN -amount
           ELSE 0
         END), 0) as total_debt
       FROM contract_events
       WHERE address = $1 AND event_type IN ('CollateralDeposited', 'LoanApproved', 'LoanRepaid', 'CollateralReleased')`,
      [agentPublicKey],
    ),
    // Recent transactions
    query(
      `SELECT event_type, amount, loan_id, created_at
       FROM contract_events
       WHERE address = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [agentPublicKey],
    ),
  ]);

  const floatRow = floatResult.rows[0] as Record<string, unknown>;
  const earningsRow = earningsResult.rows[0] as Record<string, unknown>;
  const portfolioRow = portfolioResult.rows[0] as Record<string, unknown> | undefined;
  const settlementsRow = settlementsResult.rows[0] as Record<string, unknown>;
  const collateralRow = collateralResult.rows[0] as Record<string, unknown>;

  const totalFloat = formatNumber(floatRow.total_float as string | number | null);
  const totalWithdrawn = formatNumber(floatRow.total_withdrawn as string | number | null);
  const allocated = Math.max(0, totalFloat - totalWithdrawn);
  const utilizationPct = totalFloat > 0 ? (allocated / totalFloat) * 100 : 0;

  const totalDebt = formatNumber(collateralRow.total_debt as string | number | null);
  const totalCollateral = formatNumber(collateralRow.total_collateral as string | number | null);
  const collateralRatio = totalDebt > 0 ? totalCollateral / totalDebt : 0;

  const dashboardData: AgentDashboardData = {
    agentPublicKey,
    floatUtilization: {
      totalFloat,
      allocated,
      utilizationPct: Math.round(utilizationPct * 100) / 100,
    },
    earnings: {
      daily: formatNumber(earningsRow.daily as string | number | null),
      weekly: formatNumber(earningsRow.weekly as string | number | null),
      monthly: formatNumber(earningsRow.monthly as string | number | null),
      total: formatNumber(earningsRow.total as string | number | null),
    },
    borrowerPortfolio: {
      totalLoans: Number(portfolioRow?.total_loans ?? 0),
      activeLoans: Number(portfolioRow?.active_loans ?? 0),
      defaultedLoans: Number(portfolioRow?.defaulted_loans ?? 0),
      totalOutstanding: formatNumber(portfolioRow?.total_outstanding as string | number | null),
      byStatus: {
        active: Number(portfolioRow?.active_loans ?? 0),
        defaulted: Number(portfolioRow?.defaulted_loans ?? 0),
      },
    },
    pendingSettlements: {
      count: Number(settlementsRow.settlement_count ?? 0),
      totalValue: formatNumber(settlementsRow.total_value as string | number | null),
    },
    collateralRatio: {
      totalCollateral,
      totalDebt,
      ratio: Math.round(collateralRatio * 10000) / 10000,
    },
    recentTransactions: transactionsResult.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        type: String(r.event_type ?? ''),
        amount: formatNumber(r.amount as string | number | null),
        loanId: r.loan_id != null ? String(r.loan_id) : null,
        timestamp:
          r.created_at instanceof Date
            ? r.created_at.toISOString()
            : new Date(r.created_at as string).toISOString(),
      };
    }),
  };

  await cacheService.set(cacheKey, dashboardData, AGENT_DASHBOARD_CACHE_TTL);

  res.json(dashboardData);
});

export const clearAgentDashboardCache = asyncHandler(async (req: Request, res: Response) => {
  const agentPublicKey = req.user?.publicKey;
  if (!agentPublicKey) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const cacheKey = `agent:dashboard:${agentPublicKey}`;
  await cacheService.delete(cacheKey);

  res.json({ success: true, message: 'Agent dashboard cache cleared' });
});
