"use client";

import { useTranslations } from "next-intl";
import { useUserStore } from "../../../stores/useUserStore";
import { useAdminSystemHealth } from "../../../hooks/useApi";

export default function SystemHealthPage() {
  const t = useTranslations("AdminSystemHealth");
  const role = useUserStore((state) => state.user?.role);
  const { data, isLoading, isError } = useAdminSystemHealth();

  if (role && role !== "admin" && role !== "super_admin" && role !== "ops" && role !== "support") {
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
      ) : (
        <>
          <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="mb-4 flex items-center gap-4">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                  data?.status === "ok"
                    ? "bg-green-100 text-green-800"
                    : data?.status === "degraded"
                      ? "bg-yellow-100 text-yellow-800"
                      : "bg-red-100 text-red-800"
                }`}
              >
                {data?.status.toUpperCase() ?? "UNKNOWN"}
              </span>
              <span className="text-xs text-zinc-500">{t("lastChecked")}: {data?.timestamp ?? "—"}</span>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {data?.checks.map((check) => (
                <div
                  key={check.name}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">{check.name}</p>
                    {check.detail && (
                      <p className="text-xs text-zinc-500">{check.detail}</p>
                    )}
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      check.status === "ok"
                        ? "text-green-600"
                        : check.status === "degraded"
                          ? "text-yellow-600"
                          : "text-red-600"
                    }`}
                  >
                    {check.status}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {data?.jobs && Object.keys(data.jobs).length > 0 && (
            <section className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{t("jobsTitle")}</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {Object.entries(data.jobs).map(([name, metrics]) => {
                  const m = metrics as { lastRunAt?: string | null; lastSuccessAt?: string | null; failuresTotal?: number };
                  return (
                    <div key={name} className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
                      <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">{name}</p>
                      <p className="text-xs text-zinc-500">
                        {t("lastRun")}: {m?.lastRunAt ?? "—"}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {t("failures")}: {m?.failuresTotal ?? 0}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
