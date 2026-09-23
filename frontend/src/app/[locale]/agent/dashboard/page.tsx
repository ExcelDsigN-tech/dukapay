"use client";

import { useTranslations } from "next-intl";
import { useUserStore } from "../../../stores/useUserStore";
import { useAgentDashboard } from "../../../hooks/useApi";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(2)}%`;
}

function shortAddress(value: string | null | undefined) {
  if (!value) return "—";
  return value.length > 16
    ? `${value.slice(0, 8)}…${value.slice(-8)}`
    : value;
}

export default function AgentDashboardPage() {
  const t = useTranslations("AgentDashboard");
  const role = useUserStore((state) => state.user?.role);
  const { data, isLoading, isError, refetch } = useAgentDashboard();

  if (role && (role === "borrower" || role === "lender")) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t("forbidden")}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{t("title")}</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t("description")}</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-zinc-500">{t("loading")}</p>
      ) : isError ? (
        <p className="text-sm text-red-600">{t("error")}</p>
      ) : !data ? (
        <p className="text-sm text-zinc-500">{t("noData")}</p>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <p className="text-xs uppercase tracking-wide text-zinc-500">{t("floatUtilization")}</p>
              <p className="mt-2 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
                {formatPercent(data.floatUtilization.utilizationPct)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {formatCurrency(data.floatUtilization.allocated)} / {formatCurrency(data.floatUtilization.totalFloat)}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <p className="text-xs uppercase tracking-wide text-zinc-500">{t("totalEarnings")}</p>
              <p className="mt-2 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
                {formatCurrency(data.earnings.total)}
              </p>
              <div className="mt-2 flex gap-4 text-xs text-zinc-500">
                <span>{t("daily")}: {formatCurrency(data.earnings.daily)}</span>
                <span>{t("weekly")}: {formatCurrency(data.earnings.weekly)}</span>
                <span>{t("monthly")}: {formatCurrency(data.earnings.monthly)}</span>
              </div>
            </div>
            <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <p className="text-xs uppercase tracking-wide text-zinc-500">{t("collateralRatio")}</p>
              <p className="mt-2 text-3xl font-semibold text-zinc-950 dark:text-zinc-50">
                {formatPercent(data.collateralRatio.ratio * 100)}
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                {formatCurrency(data.collateralRatio.totalCollateral)} / {formatCurrency(data.collateralRatio.totalDebt)}
              </p>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <p className="text-xs uppercase tracking-wide text-zinc-500">{t("totalLoans")}</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
                {data.borrowerPortfolio.totalLoans}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <p className="text-xs uppercase tracking-wide text-zinc-500">{t("activeLoans")}</p>
              <p className="mt-2 text-2xl font-semibold text-green-600">
                {data.borrowerPortfolio.activeLoans}
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <p className="text-xs uppercase tracking-wide text-zinc-500">{t("defaultedLoans")}</p>
              <p className="mt-2 text-2xl font-semibold text-red-600">
                {data.borrowerPortfolio.defaultedLoans}
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{t("pendingSettlements")}</h2>
              <span className="text-sm text-zinc-500">
                {data.pendingSettlements.totalValue} {t("totalValue")}
              </span>
            </div>
            <p className="text-sm text-zinc-500">
              {data.pendingSettlements.count} {t("settlementCount")}
            </p>
          </div>

          <section>
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50 mb-3">{t("recentTransactions")}</h2>
            {data.recentTransactions.length === 0 ? (
              <p className="text-sm text-zinc-500">{t("noTransactions")}</p>
            ) : (
              <div className="space-y-2">
                {data.recentTransactions.map((tx, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-2 dark:border-zinc-800"
                  >
                    <div>
                      <span className="text-xs font-medium text-zinc-500">{tx.type}</span>
                      {tx.loanId && (
                        <span className="ml-2 text-xs text-zinc-400">{shortAddress(tx.loanId)}</span>
                      )}
                    </div>
                    <span className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                      {formatCurrency(tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="flex gap-3">
            <button
              onClick={() => refetch()}
              className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
            >
              {t("refresh")}
            </button>
            <span className="text-xs text-zinc-400">
              {t("autoRefresh")}: 10s
            </span>
          </section>
        </>
      )}
    </main>
  );
}
