import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import tl from "../../messages/tl.json";
import type { Locale } from "../app/lib/locales";

export const MESSAGES = { en, es, tl } as const;

export function IntlWrapper({ locale = "en", children }: { locale?: Locale; children: ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

export function renderWithIntl(
  ui: ReactElement,
  { locale = "en", ...options }: { locale?: Locale } & Omit<RenderOptions, "wrapper"> = {},
) {
  return render(ui, {
    wrapper: ({ children }) => <IntlWrapper locale={locale}>{children}</IntlWrapper>,
    ...options,
  });
}
