"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useUserStore } from "../../../stores/useUserStore";

export default function AdminDashboardPage() {
  const t = useTranslations("AdminDashboard");
  const role = useUserStore((state) => state.user?.role);
  const locale = useUserStore((state) => state.user?.locale ?? "en");

  if (role && role !== "admin" && role !== "super_admin" && role !== "ops" && role !== "support") {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {t("forbidden")}
        </div>
      </main>
    );
  }

  const sections = [
    {
      key: "users",
      href: `/${locale}/admin/users`,
      titleKey: "usersTitle",
      descKey: "usersDesc",
      roles: ["admin", "super_admin", "ops", "support"],
    },
    {
      key: "system",
      href: `/${locale}/admin/system/health`,
      titleKey: "systemTitle",
      descKey: "systemDesc",
      roles: ["admin", "super_admin", "ops", "support"],
    },
    {
      key: "settlement",
      href: `/${locale}/admin/settlement`,
      titleKey: "settlementTitle",
      descKey: "settlementDesc",
      roles: ["admin", "super_admin", "ops"],
    },
    {
      key: "kyc",
      href: `/${locale}/admin/kyc`,
      titleKey: "kycTitle",
      descKey: "kycDesc",
      roles: ["admin", "super_admin", "ops", "support"],
    },
    {
      key: "featureFlags",
      href: `/${locale}/admin/feature-flags`,
      titleKey: "featureFlagsTitle",
      descKey: "featureFlagsDesc",
      roles: ["admin", "super_admin"],
    },
    {
      key: "disputes",
      href: `/${locale}/admin/disputes`,
      titleKey: "disputesTitle",
      descKey: "disputesDesc",
      roles: ["admin", "super_admin", "ops", "support"],
    },
    {
      key: "governance",
      href: `/${locale}/admin/governance`,
      titleKey: "governanceTitle",
      descKey: "governanceDesc",
      roles: ["admin", "super_admin", "ops"],
    },
  ];

  const accessibleSections = sections.filter((s) => !role || s.roles.includes(role));

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{t("title")}</h1>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t("description")}</p>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        {accessibleSections.map((section) => (
          <Link
            key={section.key}
            href={section.href}
            className="block rounded-xl border border-zinc-200 p-5 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/50"
          >
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{t(section.titleKey)}</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t(section.descKey)}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
