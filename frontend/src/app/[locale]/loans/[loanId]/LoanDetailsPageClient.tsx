"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Clock, Wallet, Wifi, WifiOff } from "lucide-react";
import { LoanDetailSkeleton } from "../../../components/skeletons/LoanDetailSkeleton";
import { useLoan, useLoanAmortizationSchedule, useLoanEvents } from "../../../hooks/useApi";
import { useLoanStream } from "../../../hooks/useLoanStream";
import { RepaymentScheduleTable } from "../../../components/loan-wizard/RepaymentScheduleTable";
import { RefinanceLoanModal } from "../../../components/loan-wizard/RefinanceLoanModal";
import { ExtensionLoanModal } from "../../../components/loan-wizard/ExtensionLoanModal";
import { RepaymentProgress } from "../../../components/ui/RepaymentProgress";
import { LoanTimeline } from "../../../components/ui/LoanTimeline";
import { TxHashLink } from "../../../components/ui/TxHashLink";
import { LoanHealth } from "../../../components/loan/LoanHealth";
import { downloadCsv, rowsToCsv } from "../../../utils/csv";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function formatDate(iso: string | undefined, locale: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getDaysRemaining(deadline: string | undefined): number | null {
  if (!deadline) return null;
  const diff = new Date(deadline).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function LoanDetailsPageClient() {
  const t = useTranslations("LoanDetails");
  const locale = useLocale();
  const params = useParams<{ loanId: string }>();
  const loanId = params.loanId;
  const [isRefinanceOpen, setIsRefinanceOpen] = useState(false);
  const [isExtensionOpen, setIsExtensionOpen] = useState(false);
  const realtimeStatus = useLoanStream(loanId);
  const { data: loan, isLoading, isError } = useLoan(loanId);
  const amortizationQuery = useLoanAmortizationSchedule(loanId, {
    retry: false,
  });
  const { data: events, isLoading: eventsLoading, isError: eventsError } = useLoanEvents(loanId);

  if (isLoading) {
    return <LoanDetailSkeleton />;
  }

  if (isError) {
    return (
      <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
        {t("loadError")}
      </section>
    );
  }

  if (!loan) {
    return (
      <section className="rounded-3xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          {t("notFound.title")}
        </h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {t("notFound.description", { id: loanId })}
        </p>
        <Link
          href="/loans"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {t("notFound.back")}
        </Link>
      </section>
    );
  }

  const loanData = loan;
  const latestTxHash = loanData.events.find((event) => Boolean(event.txHash))?.txHash;
  const nextDeadline = (loanData as unknown as { nextPaymentDeadline?: string })
    .nextPaymentDeadline;
  const daysRemaining = getDaysRemaining(nextDeadline);
  const normalizedStatus = String(loan.status).toLowerCase();
  const canManageApprovedLoan = normalizedStatus === "approved" || normalizedStatus === "active";

  function exportCsv() {
    const sourceEvents = events ?? loanData.events;
    const rows = sourceEvents.map((event) => ({
      date: event.timestamp,
      type: event.type,
      amount: event.amount,
      asset: "USD",
      status: loanData.status,
      transactionHash: event.txHash ?? "",
    }));

    downloadCsv(`loan-${loanId}.csv`, rowsToCsv(rows));
  }

  return (
    <section className="space-y-6">
      <nav
        aria-label={t("breadcrumb.label")}
        className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400"
      >
        <Link href="/" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition">
          {t("breadcrumb.home")}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link href="/loans" className="hover:text-zinc-900 dark:hover:text-zinc-100 transition">
          {t("breadcrumb.loans")}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-zinc-900 dark:text-zinc-50">
          {t("loanNumber", { id: loanId })}
        </span>
      </nav>

      <header className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">
              {t("eyebrow")}
            </p>
            <h1 className="mt-3 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
              {t("loanNumber", { id: loanId })}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
              {t("description")}
            </p>
            <div
              className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                realtimeStatus === "connected"
                  ? "bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                  : realtimeStatus === "polling"
                    ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                    : realtimeStatus === "disconnected"
                      ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {realtimeStatus === "connected" ? (
                <Wifi className="h-3.5 w-3.5" />
              ) : (
                <WifiOff className="h-3.5 w-3.5" />
              )}
              {realtimeStatus === "connected"
                ? t("realtime.connected")
                : realtimeStatus === "polling"
                  ? t("realtime.polling")
                  : realtimeStatus === "disconnected"
                    ? t("realtime.disconnected")
                    : t("realtime.connecting")}
            </div>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!events || events.length === 0}
            className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            {t("exportCsv")}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
          {loan.interestRate > 0 && (
            <span>
              {t("meta.interestRate")}{" "}
              <strong className="text-zinc-900 dark:text-zinc-50">
                {loan.interestRate.toFixed(2)}%
              </strong>
            </span>
          )}
          {loan.requestedAt && (
            <span>
              {t("meta.requested")}{" "}
              <strong className="text-zinc-900 dark:text-zinc-50">
                {formatDate(loan.requestedAt, locale)}
              </strong>
            </span>
          )}
          {loan.approvedAt && (
            <span>
              {t("meta.approved")}{" "}
              <strong className="text-zinc-900 dark:text-zinc-50">
                {formatDate(loan.approvedAt, locale)}
              </strong>
            </span>
          )}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <article className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            {t("plan.title")}
          </h2>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {[
              [t("plan.principal"), formatCurrency(loan.principal)],
              [t("plan.interestAccrued"), formatCurrency(loan.accruedInterest)],
              [t("plan.totalRepaid"), formatCurrency(loan.totalRepaid)],
              [t("plan.totalOwed"), formatCurrency(loan.totalOwed)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-900">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
                <p className="mt-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                  {value}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-6">
            <RepaymentProgress
              totalRepaid={loan.totalRepaid}
              totalOwed={loan.totalOwed}
              status={loan.status}
            />
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              {t("timeline.title")}
            </h3>
            <div className="mt-3">
              {eventsLoading ? (
                <div className="animate-pulse space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex gap-3">
                      <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                      <div className="flex-1 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                        <div className="h-4 w-24 rounded bg-zinc-200 dark:bg-zinc-700" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : eventsError ? (
                <p className="text-sm text-red-500 dark:text-red-400">{t("timeline.error")}</p>
              ) : events && events.length > 0 ? (
                <LoanTimeline events={events} />
              ) : (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("timeline.empty")}</p>
              )}
            </div>
          </div>

          {amortizationQuery.data && (
            <div className="mt-6">
              <RepaymentScheduleTable
                amortization={amortizationQuery.data}
                title={t("amortization.title")}
                description={t("amortization.description")}
                compact
              />
            </div>
          )}

          {amortizationQuery.isError && (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              {t("amortization.unavailable")}
            </div>
          )}
        </article>

        <aside className="space-y-4">
          <LoanHealth
            loan={loan}
            isLoading={isLoading}
            isError={isError}
            topUpHref="#collateral-top-up"
            labels={{
              title: t("health.title"),
              loading: t("health.loading"),
              unavailableTitle: t("health.unavailableTitle"),
              unavailableDescription: t("health.unavailableDescription"),
              collateral: t("health.collateral"),
              totalDebt: t("health.totalDebt"),
              threshold: t("health.threshold"),
              sourceContract: t("health.sourceContract"),
              sourceBackend: t("health.sourceBackend"),
              sourceDerived: t("health.sourceDerived"),
              cta: t("health.cta"),
              states: {
                healthy: t("health.states.healthy"),
                watch: t("health.states.watch"),
                atRisk: t("health.states.atRisk"),
              },
              descriptions: {
                healthy: t("health.descriptions.healthy"),
                watch: t("health.descriptions.watch"),
                atRisk: t("health.descriptions.atRisk"),
              },
            }}
          />

          {loan.status === "active" && daysRemaining !== null && (
            <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
              <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                <Clock className="h-4 w-4" />
                <h2 className="text-sm font-semibold">{t("nextPayment.title")}</h2>
              </div>
              <p
                className={`mt-2 text-2xl font-bold ${
                  daysRemaining <= 3
                    ? "text-red-600 dark:text-red-400"
                    : daysRemaining <= 7
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-zinc-900 dark:text-zinc-50"
                }`}
              >
                {daysRemaining <= 0
                  ? t("nextPayment.overdue")
                  : daysRemaining === 1
                    ? t("nextPayment.tomorrow")
                    : t("nextPayment.days", { days: daysRemaining })}
              </p>
              {nextDeadline && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {new Date(nextDeadline).toLocaleDateString(locale, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              )}
            </div>
          )}

          <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
            <div className="rounded-2xl bg-indigo-50 p-5 dark:bg-indigo-500/10">
              <div className="flex items-center gap-3 text-indigo-700 dark:text-indigo-300">
                <Wallet className="h-5 w-5" />
                <h2 className="text-lg font-semibold">{t("nextAction.title")}</h2>
              </div>
              <p className="mt-3 text-sm leading-6 text-indigo-700/80 dark:text-indigo-200">
                {t("nextAction.description")}
              </p>
              {loan.status !== "repaid" &&
                loan.status !== "defaulted" &&
                loan.status !== "liquidated" && (
                  <Link
                    href={`/repay/${loanId}`}
                    className="mt-4 inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
                  >
                    {t("nextAction.makePayment")}
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                )}
              {canManageApprovedLoan && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setIsRefinanceOpen(true)}
                    className="inline-flex items-center rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 dark:border-indigo-800 dark:bg-zinc-950 dark:text-indigo-300 dark:hover:bg-zinc-900"
                  >
                    {t("actions.refinance")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsExtensionOpen(true)}
                    className="inline-flex items-center rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 dark:border-indigo-800 dark:bg-zinc-950 dark:text-indigo-300 dark:hover:bg-zinc-900"
                  >
                    {t("actions.requestExtension")}
                  </button>
                </div>
              )}

              {latestTxHash && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium text-indigo-700/70 dark:text-indigo-300/70">
                    {t("nextAction.latestTransaction")}
                  </p>
                  <TxHashLink txHash={latestTxHash} />
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {t("collateral.title")}
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {loan.status === "liquidated"
                ? t("collateral.liquidated")
                : loan.status === "defaulted"
                  ? t("collateral.defaulted")
                  : loan.status === "repaid"
                    ? t("collateral.repaid")
                    : t("collateral.held")}
            </p>
          </div>
        </aside>
      </div>

      <RefinanceLoanModal
        isOpen={isRefinanceOpen}
        onClose={() => setIsRefinanceOpen(false)}
        onSuccess={() => {
          amortizationQuery.refetch();
        }}
        loanId={loanId}
        currentPrincipal={loan.principal}
        currentInterestRate={loan.interestRate}
        title={t("refinance.title")}
        submitLabel={t("refinance.submit")}
        cancelLabel={t("common.cancel")}
        principalLabel={t("refinance.principal")}
        interestRateLabel={t("refinance.interestRate")}
        termLabel={t("refinance.term")}
        previewTitle={t("refinance.previewTitle")}
        previewDescription={t("refinance.previewDescription")}
        busyLabel={t("common.confirming")}
      />

      <ExtensionLoanModal
        isOpen={isExtensionOpen}
        onClose={() => setIsExtensionOpen(false)}
        onSuccess={() => {
          amortizationQuery.refetch();
        }}
        loanId={loanId}
        currentDueDate={nextDeadline}
        title={t("extension.title")}
        submitLabel={t("extension.submit")}
        cancelLabel={t("common.cancel")}
        ledgersLabel={t("extension.extraLedgers")}
        newDueDateLabel={t("extension.newDueDate")}
        busyLabel={t("common.confirming")}
      />
    </section>
  );
}
