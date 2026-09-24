"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useUserStore } from "../../../stores/useUserStore";
import { useTriggerSettlement } from "../../../hooks/useApi";

export default function AdminSettlementPage() {
  const t = useTranslations("AdminSettlement");
  const role = useUserStore((state) => state.user?.role);
  const { mutate: trigger, isPending, isError, isSuccess, error, data } = useTriggerSettlement();

  const [loanIdsInput, setLoanIdsInput] = useState("");
  const [force, setForce] = useState(false);

  if (role && role !== "admin" && role !== "super_admin" && role !== "ops") {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t("forbidden")}
        </div>
      </main>
    );
  }

  const handleTrigger = async () => {
    const loanIds = loanIdsInput
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(Number);

    if (loanIds.length > 0 && loanIds.some((n) => !Number.isInteger(n) || n <= 0)) {
      return;
    }

    await trigger({ loanIds: loanIds.length > 0 ? loanIds : undefined, force });
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{t("title")}</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t("description")}</p>
      </div>

      <section className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800 space-y-4">
        <div>
          <label htmlFor="loanIds" className="block text-sm font-medium text-zinc-950 dark:text-zinc-50">
            {t("loanIdsLabel")}
          </label>
          <input
            id="loanIds"
            type="text"
            placeholder={t("loanIdsPlaceholder")}
            value={loanIdsInput}
            onChange={(e) => setLoanIdsInput(e.target.value)}
            className="mt-1 block w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <p className="mt-1 text-xs text-zinc-500">{t("loanIdsHelp")}</p>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
          />
          <span className="text-sm text-zinc-700 dark:text-zinc-300">{t("forceLabel")}</span>
        </label>

        <button
          onClick={handleTrigger}
          disabled={isPending}
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {isPending ? t("triggering") : t("triggerButton")}
        </button>
      </section>

      {isError && (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <p className="font-medium">{t("error")}</p>
          <p className="mt-1 text-sm">{error?.message ?? t("errorDetail")}</p>
        </section>
      )}

      {isSuccess && data && (
        <section className="rounded-2xl border border-green-200 bg-green-50 p-4 text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
          <p className="font-medium">{t("success")}</p>
          {data.details && (
            <pre className="mt-2 max-h-48 overflow-auto text-xs">
              {JSON.stringify(data.details, null, 2)}
            </pre>
          )}
        </section>
      )}
    </main>
  );
}
