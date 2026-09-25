import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale } from "./src/app/lib/locales";

export default getRequestConfig(async ({ locale, requestLocale }) => {
  // `locale` is only set when a server function is called with an explicit
  // locale; otherwise use the [locale] segment matched by the proxy.
  const requested = locale ?? (await requestLocale);
  const resolved = requested && isLocale(requested) ? requested : DEFAULT_LOCALE;

  return {
    locale: resolved,
    messages: (await import(`./messages/${resolved}.json`)).default,
  };
});
