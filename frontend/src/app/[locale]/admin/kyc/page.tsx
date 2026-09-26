"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useUserStore } from "../../../stores/useUserStore";
import { useAdminUsers, useKycOverride } from "../../../hooks/useApi";

export default function AdminKycPage() {
  const t = useTranslations("AdminKyc");
  const role = useUserStore((state) => state.user?.role);
  const { data, isLoading } = useAdminUsers({ limit: 100 });
  const { mutateAsync: overrideKyc, isPending } = useKycOverride();
  const overrideKyc = useKycOverride();
  const [targetKey, setTargetKey] = useState("");
  const [verified, setVerified] = useState(true);
  const [level, setLevel] = useState("basic");

  if (role && role !== "admin" && role !== "super_admin" && role !== "ops" && role !== "support") {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t("forbidden")}
        </div>
      </main>
    );
  }

  const handleSubmit = async () => {
    if (!targetKey) return;
    await overrideKyc({ publicKey: targetKey, verified, level });
    setTargetKey("");
  };

  const handleUserOverride = async (publicKey: string, newVerified: boolean) => {
    await overrideKyc({ publicKey, verified: newVerified, level: "basic" });
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{t("title")}</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t("description")}</p>
      </div>

      <section className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800 space-y-4">
        <div>
          <label
            htmlFor="publicKey"
            className="block text-sm font-medium text-zinc-950 dark:text-zinc-50"
          >
            {t("publicKeyLabel")}
          </label>
          <input
            id="publicKey"
            type="text"
            placeholder={t("publicKeyPlaceholder")}
            value={targetKey}
            onChange={(e) => setTargetKey(e.target.value)}
            className="mt-1 block w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>

        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={verified}
            onChange={() => setVerified(true)}
            className="text-zinc-900 focus:ring-zinc-900"
          />
          <span className="text-sm text-zinc-700 dark:text-zinc-300">{t("verified")}</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={!verified}
            onChange={() => setVerified(false)}
            className="text-zinc-900 focus:ring-zinc-900"
          />
          <span className="text-sm text-zinc-700 dark:text-zinc-300">{t("notVerified")}</span>
        </label>

        <div>
          <label
            htmlFor="level"
            className="block text-sm font-medium text-zinc-950 dark:text-zinc-50"
          >
            {t("levelLabel")}
          </label>
          <select
            id="level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="mt-1 block w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <option value="basic">{t("levelBasic")}</option>
            <option value="enhanced">{t("levelEnhanced")}</option>
            <option value="premium">{t("levelPremium")}</option>
          </select>
        </div>

        <button
          onClick={handleSubmit}
          disabled={overrideKyc.isPending || !targetKey}
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {overrideKyc.isPending ? t("applying") : t("applyButton")}
        </button>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
          {t("userListTitle")}
        </h2>
        {isLoading ? (
          <p className="mt-2 text-sm text-zinc-500">{t("loading")}</p>
        ) : (
          <table className="mt-2 min-w-full divide-y divide-zinc-200">
            <thead>
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase text-zinc-500">
                  {t("user")}
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase text-zinc-500">
                  {t("currentStatus")}
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium uppercase text-zinc-500">
                  {t("actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {data?.users?.map((user) => (
                <tr key={user.id}>
                  <td className="px-4 py-2">
                    <p className="font-mono text-xs text-zinc-500">
                      {user.publicKey.slice(0, 8)}…{user.publicKey.slice(-4)}
                    </p>
                  </td>
                  <td className="px-4 py-2">
                    {user.kycVerified ? (
                      <span className="text-sm text-green-600">{t("verified")}</span>
                    ) : (
                      <span className="text-sm text-zinc-500">{t("notVerified")}</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right space-x-1">
                    {!user.kycVerified && (
                      <button
                        onClick={() => handleUserOverride(user.publicKey, true)}
                        className="text-xs text-green-600 hover:text-green-800"
                      >
                        {t("approve")}
                      </button>
                    )}
                    {user.kycVerified && (
                      <button
                        onClick={() => handleUserOverride(user.publicKey, false)}
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        {t("revoke")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
