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
            `script-src 'self'${isDev ? " 'unsafe-eval'" : ""}`,
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
