"use client";

import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLocaleSwitcher } from "../../hooks/useLocaleSwitcher";
import { LOCALES, LOCALE_LABELS } from "../../lib/locales";

export function LanguageSwitcher() {
  const t = useTranslations("Settings");
  const { locale, switchLocale, isPending } = useLocaleSwitcher();

  return (
    <div className="relative flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 hover:border-zinc-300 transition-colors dark:border-zinc-800 dark:hover:border-zinc-700">
      <Languages className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
      <select
        value={locale}
        disabled={isPending}
        onChange={(event) => switchLocale(event.target.value)}
        aria-label={t("selectLanguage")}
        className="bg-transparent text-sm font-medium text-zinc-900 focus:outline-none dark:text-zinc-50 appearance-none cursor-pointer"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    </div>
  );
}
