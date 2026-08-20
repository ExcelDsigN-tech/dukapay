"use client";

import { useTranslations } from "next-intl";
import {
  BadgeCheck,
  HandCoins,
  Landmark,
  Send,
  ShieldCheck,
  Sparkles,
  Trophy,
  WalletCards,
} from "lucide-react";

interface LandingPageProps {
  onConnect: () => void;
}

export function LandingPage({ onConnect }: LandingPageProps) {
  const t = useTranslations("Landing");

  return (
    <div className="overflow-hidden bg-[#0D0D12] text-[#F1F5F9]">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section
        aria-labelledby="landing-hero-title"
        className="relative isolate overflow-hidden px-6 pb-16 pt-14 sm:px-10 sm:pt-20"
      >
        {/* Glow backdrop */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_30%_20%,rgba(124,58,237,0.35),transparent_55%),radial-gradient(circle_at_80%_0%,rgba(14,207,207,0.28),transparent_50%)]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 opacity-40 [background-image:radial-gradient(rgba(241,245,249,0.12)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]"
        />

        <p className="inline-flex items-center gap-2 rounded-full border border-[#7C3AED]/40 bg-[#7C3AED]/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-[#0ECFCF]">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          {t("hero.eyebrow")}
        </p>

        <h1
          id="landing-hero-title"
          className="mt-5 max-w-2xl text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl"
        >
          {t("hero.title")}
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-[#9aa4b5] sm:text-lg">
          {t("hero.tagline")}
        </p>

        {/* Metrics */}
        <dl aria-label="Platform metrics" className="mt-8 flex max-w-md gap-8 sm:gap-12">
          <div>
            <dd className="text-3xl font-black tracking-tight text-white sm:text-4xl">
              {t("hero.tvl")}
            </dd>
            <dt className="mt-1 text-xs font-medium uppercase tracking-wider text-[#64748B]">
              {t("hero.tvlLabel")}
            </dt>
          </div>
          <div>
            <dd className="text-3xl font-black tracking-tight text-white sm:text-4xl">
              {t("hero.yield")}
            </dd>
            <dt className="mt-1 text-xs font-medium uppercase tracking-wider text-[#64748B]">
              {t("hero.yieldLabel")}
            </dt>
          </div>
        </dl>

        <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onConnect}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-7 py-3.5 text-base font-bold text-white shadow-lg shadow-[#7C3AED]/30 transition-all hover:bg-[#6d28d9] hover:shadow-[#7C3AED]/40 focus-visible:ring-2 focus-visible:ring-[#0ECFCF]"
          >
            <WalletCards className="h-5 w-5" aria-hidden="true" />
            {t("hero.cta")}
          </button>
          <a
            href={t("hero.telegramUrl")}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#0ECFCF]/40 bg-[#0ECFCF]/10 px-7 py-3.5 text-base font-bold text-[#0ECFCF] transition-all hover:bg-[#0ECFCF]/20 focus-visible:ring-2 focus-visible:ring-[#0ECFCF]"
          >
            <Send className="h-5 w-5" aria-hidden="true" />
            {t("hero.telegram")}
          </a>
          <span className="text-sm font-medium text-[#64748B]">{t("hero.subCta")}</span>
        </div>
      </section>

      {/* ── Arsenal ──────────────────────────────────────────── */}
      <section
        aria-labelledby="landing-arsenal-title"
        className="border-t border-white/10 bg-[#16161F] px-6 py-14 sm:px-10"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-[#0ECFCF]">
          {t("arsenal.eyebrow")}
        </p>
        <h2
          id="landing-arsenal-title"
          className="mt-2 text-2xl font-black tracking-tight sm:text-3xl"
        >
          {t("arsenal.title")}
        </h2>
        <p className="mt-2 text-sm text-[#9aa4b5]">{t("arsenal.subtitle")}</p>

        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <li className="flex items-start gap-4 rounded-2xl border border-white/10 bg-[#0D0D12] p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#7C3AED]/15 text-[#7C3AED]">
              <HandCoins className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-bold">{t("arsenal.lendTitle")}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[#64748B]">{t("arsenal.lendDesc")}</p>
            </div>
          </li>
          <li className="flex items-start gap-4 rounded-2xl border border-white/10 bg-[#0D0D12] p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#0ECFCF]/15 text-[#0ECFCF]">
              <Trophy className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-bold">{t("arsenal.questsTitle")}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[#64748B]">
                {t("arsenal.questsDesc")}
              </p>
            </div>
          </li>
          <li className="flex items-start gap-4 rounded-2xl border border-white/10 bg-[#0D0D12] p-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#22C55E]/15 text-[#22C55E]">
              <ShieldCheck className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h3 className="font-bold">{t("arsenal.vaultsTitle")}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[#64748B]">
                {t("arsenal.vaultsDesc")}
              </p>
            </div>
          </li>
        </ul>
      </section>

      {/* ── Verified Growth ──────────────────────────────────── */}
      <section
        aria-labelledby="landing-verified-title"
        className="border-t border-white/10 px-6 py-14 sm:px-10"
      >
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-lg">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#22C55E]">
              {t("verified.eyebrow")}
            </p>
            <h2
              id="landing-verified-title"
              className="mt-2 text-2xl font-black tracking-tight sm:text-3xl"
            >
              {t("verified.title")}
            </h2>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#22C55E]/40 bg-[#22C55E]/10 px-3 py-1 text-xs font-semibold text-[#22C55E]">
                <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                {t("verified.audit")}
              </span>
              <span className="text-sm text-[#64748B]">{t("verified.auditDesc")}</span>
            </div>
          </div>

          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#16161F] p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0ECFCF]/15 text-[#0ECFCF]">
                <Landmark className="h-6 w-6" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-bold">{t("verified.stellarTitle")}</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[#9aa4b5]">
              {t("verified.stellarDesc")}
            </p>
          </div>
        </div>
      </section>

      {/* ── Gates ────────────────────────────────────────────── */}
      <section
        aria-labelledby="landing-gates-title"
        className="border-t border-white/10 bg-[#16161F] px-6 py-14 sm:px-10"
      >
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#7C3AED]">
            {t("gates.eyebrow")}
          </p>
          <h2
            id="landing-gates-title"
            className="mt-3 text-3xl font-black tracking-tight sm:text-4xl"
          >
            {t("gates.title")}
          </h2>
          <p className="mt-3 text-sm text-[#9aa4b5]">{t("gates.subtitle")}</p>

          <button
            type="button"
            onClick={onConnect}
            className="mt-8 inline-flex items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-8 py-3.5 text-base font-bold text-white shadow-lg shadow-[#7C3AED]/30 transition-all hover:bg-[#6d28d9] focus-visible:ring-2 focus-visible:ring-[#0ECFCF]"
          >
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            {t("gates.cta")}
          </button>
        </div>
      </section>
    </div>
  );
}
