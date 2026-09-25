"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { isLocale, localizePathname, persistLocale, type Locale } from "../lib/locales";

export function useLocaleSwitcher() {
  const [isPending, startTransition] = useTransition();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const switchLocale = (next: string) => {
    if (!isLocale(next) || next === locale) return;
    persistLocale(next);
    const { search, hash } = window.location;
    startTransition(() => {
      router.replace(`${localizePathname(pathname, next)}${search}${hash}`);
    });
  };

  return { locale: locale as Locale, switchLocale, isPending };
}
