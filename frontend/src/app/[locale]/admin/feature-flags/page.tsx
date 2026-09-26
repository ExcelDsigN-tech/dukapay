"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useUserStore } from "../../../stores/useUserStore";
import { useFeatureFlags, useUpdateFeatureFlag } from "../../../hooks/useApi";

export default function AdminFeatureFlagsPage() {
  const t = useTranslations("AdminFeatureFlags");
  const role = useUserStore((state) => state.user?.role);
  const { data, isLoading, isError } = useFeatureFlags();
  const { mutateAsync: updateFlag } = useUpdateFeatureFlag();
  const updateFlag = useUpdateFeatureFlag();

  if (role && role !== "admin" && role !== "super_admin") {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t("forbidden")}
        </div>
      </main>
    );
  }

  const handleToggle = async (flagKey: string, current: boolean) => {
    await updateFlag({ key: flagKey, enabled: !current });
  };

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
        <section className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-500">
                  {t("flag")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-500">
                  {t("description")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-500">
                  {t("scope")}
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase text-zinc-500">
                  {t("status")}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-500">
                  {t("actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {data?.flags.map((flag) => (
                <tr key={flag.key}>
                  <td className="px-4 py-3">
                    <code className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                      {flag.key}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-700 dark:text-zinc-300">
                    {flag.name}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">{flag.scope}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                        flag.enabled ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                      }`}
                    >
                      {flag.enabled ? t("enabled") : t("disabled")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleToggle(flag.key, flag.enabled)}
                      className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      {flag.enabled ? t("disable") : t("enable")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
