import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import withSerwistInit from "@serwist/next";

const withNextIntl = createNextIntlPlugin("./i18n.config.ts");

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
});

// The documented local/dev default (http://localhost:3001, see .env.example)
// is neither 'self' (different port) nor https:, so connect-src must name it
// explicitly or every browser fetch to the API is silently CSP-blocked.
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Next.js dev mode (webpack and Turbopack alike) executes hot-reloaded
// module chunks via eval() — without 'unsafe-eval' the dev bundle can't run
// at all, so nothing hydrates. Production builds don't need it.
const isDev = process.env.NODE_ENV !== "production";

// The App Router streams its RSC/hydration payload through inline
// <script> tags (self.__next_f.push(...), self.__next_r, etc.) on every
// render, dev and prod alike — without 'unsafe-inline' those are blocked
// and the app never hydrates (confirmed via
// "Invariant: Expected a request ID to be defined for the document via
// self.__next_r" in the browser console). The fully-strict fix is a
// nonce-based CSP via middleware, but that forces dynamic rendering on
// every route (no static optimization, no CDN caching) — a bigger call
// than this fix should make alone. 'unsafe-inline' matches Next.js's own
// documented non-nonce fallback and the precedent already set below for
// style-src.
// ponytail: unsafe-inline on script-src, upgrade to nonce-based CSP
// (https://nextjs.org/docs/app/guides/content-security-policy#nonces) if
// stricter XSS protection becomes a requirement.

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Issue #407: Security headers for XSS prevention
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self' https: data:",
            `connect-src 'self' https: ${apiUrl}`,
            "frame-ancestors 'self'",
          ].join("; "),
        },
        {
          key: "X-Content-Type-Options",
          value: "nosniff",
        },
        {
          key: "X-Frame-Options",
          value: "DENY",
        },
        {
          key: "Referrer-Policy",
          value: "strict-origin-when-cross-origin",
        },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=()",
        },
      ],
    },
  ],
};

const config = withSerwist(nextConfig);

export default withNextIntl(
  withSentryConfig(config, {
    silent: !process.env.CI,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    sourcemaps: {
      disable: !process.env.SENTRY_AUTH_TOKEN,
    },
    autoInstrumentServerFunctions: true,
  }),
);
