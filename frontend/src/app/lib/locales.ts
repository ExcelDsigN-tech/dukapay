// Every locale here must have a matching messages/<code>.json file.
export const LOCALES = ["en", "es", "tl"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
  tl: "Tagalog",
};

// next-intl's proxy reads this cookie to pick the locale for unprefixed URLs.
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function persistLocale(locale: Locale) {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}

export function localizePathname(pathname: string, locale: Locale): string {
  const segments = pathname.split("/");
  if (isLocale(segments[1] ?? "")) {
    segments[1] = locale;
    return segments.join("/");
  }
  return `/${locale}${pathname === "/" ? "" : pathname}`;
}
