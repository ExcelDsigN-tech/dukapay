import createMiddleware from "next-intl/middleware";
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "./app/lib/locales";

export default createMiddleware({
  // A list of all locales that are supported
  locales: LOCALES,

  // Used when no locale matches
  defaultLocale: DEFAULT_LOCALE,

  // Remember the chosen language across visits
  localeCookie: { name: LOCALE_COOKIE, maxAge: LOCALE_COOKIE_MAX_AGE },
});

export const config = {
  // Match only internationalized pathnames
  matcher: ["/", "/(en|es|tl)/:path*"],
};
