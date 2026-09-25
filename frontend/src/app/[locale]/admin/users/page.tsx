"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useUserStore } from "../../../stores/useUserStore";
import {
  useAdminUsers,
  useUpdateUserStatus,
  useUpdateUserRole,
  type AdminUser,
} from "../../../hooks/useApi";

const ROLES = ["admin", "super_admin", "ops", "support", "borrower", "lender"] as const;

export default function AdminUsersPage() {
  const t = useTranslations("AdminUsers");
  const role = useUserStore((state) => state.user?.role);

  const { data, isLoading, isError } = useAdminUsers({ limit: 50 });
  const updateUserStatus = useUpdateUserStatus();
  const updateUserRole = useUpdateUserRole();

  const [actionUser, setActionUser] = useState<AdminUser | null>(null);
  const [actionType, setActionType] = useState<"suspend" | "activate" | "role" | null>(null);

  if (role && role !== "admin" && role !== "super_admin" && role !== "ops" && role !== "support") {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t("forbidden")}
        </div>
      </main>
    );
  }

  const handleSuspend = (user: AdminUser) => {
    setActionUser(user);
    setActionType("suspend");
  };

  const handleActivate = (user: AdminUser) => {
    setActionUser(user);
    setActionType("activate");
  };

  const handleRoleChange = (user: AdminUser) => {
    setActionUser(user);
    setActionType("role");
  };

  const confirmAction = async () => {
    if (!actionUser || !actionType) return;

    if (actionType === "suspend" || actionType === "activate") {
      await updateUserStatus.mutateAsync({
        publicKey: actionUser.publicKey,
        isSuspended: actionType === "suspend",
      });
    }

    setActionUser(null);
    setActionType(null);
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
                  {t("user")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-500">
                  {t("role")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-500">
                  {t("status")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-zinc-500">
                  {t("kyc")}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-zinc-500">
                  {t("actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {data?.users?.map((user) => (
                <tr key={user.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="px-4 py-3">
                    <p className="font-mono text-xs text-zinc-500">
                      {user.publicKey.slice(0, 8)}…{user.publicKey.slice(-4)}
                    </p>
                    <p className="text-sm text-zinc-950 dark:text-zinc-50">
                      {user.displayName || user.email || t("noName")}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={user.role}
                      onChange={async (e) => {
                        await updateUserRole.mutateAsync({
                          publicKey: user.publicKey,
                          role: e.target.value,
                        });
                      }}
                      className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {user.isSuspended ? (
                      <span className="text-sm text-red-600">{t("suspended")}</span>
                    ) : (
                      <span className="text-sm text-green-600">{t("active")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {user.kycVerified ? (
                      <span className="text-sm text-green-600">{t("verified")}</span>
                    ) : (
                      <span className="text-sm text-zinc-500">{t("notVerified")}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() =>
                        user.isSuspended ? handleActivate(user) : handleSuspend(user)
                      }
                      className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    >
                      {user.isSuspended ? t("activate") : t("suspend")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {actionUser && actionType && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/30">
          <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 max-w-sm">
            <h3 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              {actionType === "suspend" ? t("confirmSuspend") : t("confirmActivate")}
            </h3>
            <p className="mt-2 text-sm text-zinc-500">
              {actionUser.displayName || actionUser.email || actionUser.publicKey.slice(0, 8)}
            </p>
            <div className="mt-4 flex gap-3">
              <button
                onClick={confirmAction}
                className="flex-1 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {t("confirm")}
              </button>
              <button
                onClick={() => {
                  setActionUser(null);
                  setActionType(null);
                }}
                className="flex-1 rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
