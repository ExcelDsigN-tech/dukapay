# DukaPay — Technical Requirements Document (Reverse-Engineered)

## Frontend

- **Next.js 16**, React 19, TypeScript
- App Router with i18n routing: all real pages live under `frontend/src/app/[locale]/...` (`next-intl`)
- Styling: Tailwind CSS v4 (CSS-first config via `@theme inline` in `globals.css`, no `tailwind.config.js`)
- State/data: TanStack Query (server state), Zustand (client state)
- PWA: Serwist (service worker, precaching, install prompt, offline banner)
- Charts: Recharts (`CreditScoreTrendChart`, `RiskTierChart`, `YieldEarningsChart`)
- Animation: Framer Motion, Lottie (`lottie-react`)
- Wallet: `@stellar/freighter-api`, `@stellar/stellar-sdk`
- Testing: Jest + Testing Library (unit), Playwright (e2e, `frontend/e2e`), axe-playwright (a11y), Lighthouse CI (perf budgets, `lighthouse-budget.json`)
- Observability: `@sentry/nextjs` (client/server/edge configs present)

## Backend

- **Node.js ≥20**, Express 5, TypeScript, ESM (`"type": "module"`)
- Auth: custom wallet challenge/response + JWT (`jsonwebtoken`), refresh-token rotation, CSRF middleware, cookie name `dukapay_jwt`
- Validation: Zod at every route boundary (`schemas/`)
- DB access: `pg` (node-postgres), migrations via `node-pg-migrate` (**49 migrations**, `.cjs` format only — no raw `.sql` files are executed)
- Cache: Redis (`redis` client)
- Background jobs: `node-cron` (score reconciliation, default checks, indexer polling)
- Observability: `@sentry/node`, `prom-client` (Prometheus metrics), `winston` (structured logs)
- API docs: `swagger-jsdoc` + `swagger-ui-express`, served at `/docs` (non-production only), generated/validated via `scripts/generateOpenApi.ts` / `scripts/validateOpenApi.ts`
- Comms: `@sendgrid/mail` (email), `twilio` (SMS)
- Rate limiting: `express-rate-limit` (per-route and IP-based, e.g. login/challenge endpoints)
- Security headers: `helmet`
- Testing: Jest (ESM mode via `--experimental-vm-modules`)

## Smart Contracts

- **Rust 1.85**, `soroban-sdk` 22.0.0, Cargo workspace (`contracts/Cargo.toml`), resolver v2
- Workspace members (9): `money`, `remittance_nft`, `loan_manager`, `lending_pool`, `multisig_governance`, `agent_registry`, `agent_vault`, `audit_anchor`, `oracle`
- **Not in workspace** (exists on disk, not built by default): `circuit_breaker`
- **Excluded explicitly**: `fuzz` (property-based test harness via `proptest`, run separately)
- Release profile: `panic = "abort"`, LTO, `codegen-units = 1`, symbols stripped — optimized for WASM size/gas, standard Soroban practice
- Contract upgrades gated through `multisig_governance` (3-of-5, 48h timelock, 14-day TTL, emergency pause) — **only for contracts migrated to that admin**; others still use a raw admin key

## Indexer

- Standalone Rust binary (`dukapay-indexer`), Tokio async runtime
- Optional features: `postgres` (via `sqlx`, default-on), `kafka` (via `rdkafka`, opt-in)
- Exposes Prometheus metrics via `hyper` HTTP server
- Reorg-safety: finality-depth config, checkpointing (migrations `create-ledger-checkpoints`, `reorg-safe-indexer`)

## SDK

- `@dukapay/sdk`, TypeScript, bundled with `tsup` (dual ESM/CJS + `.d.ts`)
- Two entry points: root (typed API client, Stellar contract helpers, wallet adapters) and `/react` (hooks)
- Tested with Vitest

## Database

- **PostgreSQL** (16.9 in docker-compose), no managed-BaaS provider (not Supabase-hosted — Supabase's *claims model* is referenced only as a compatibility pattern for RLS, see Backend Schema doc)
- Connection pooling via `pgbouncer` (`ops/pgbouncer`)
- Row-Level Security enabled (migration `enable-rls`) as a defense-in-depth layer alongside application-level RBAC

## Authentication

- **Wallet-based challenge/response**, not email/password: `POST /auth/challenge` → sign with Stellar wallet → `POST /auth/login` → JWT set as httpOnly cookie
- Roles are **not stored per-user in a table** — they're derived at request time from wallet-address membership in env vars (`ADMIN_WALLETS`, `AGENT_WALLETS`, `AUDITOR_WALLETS`, `LENDER_WALLETS`); unlisted wallets default to `borrower`
- `POST /auth/kyc` submits KYC after login; `POST /auth/refresh` rotates tokens; `POST /auth/logout` invalidates

## Hosting & Deployment

- **Local/staging**: Docker Compose (`docker-compose.yml`, `docker-compose.staging.yml`) — Postgres, Redis, backend, frontend containers
- **Infra-as-code**: Terraform blue-green deployment (`infra/blue-green-deployment.tf`), Kubernetes manifests (`infra/kubernetes`)
- **CI/CD**: GitHub Actions — `deploy-staging.yml`, `deploy-blue-green.sh` / `rollback-blue-green.sh` scripts in `scripts/`
- No evidence of Vercel/Railway/Fly.io usage — deployment target is self-hosted (Docker/Kubernetes), not a PaaS

## Third-Party APIs & Services

| Service | Purpose | Notes |
|---|---|---|
| Stellar Soroban RPC | Chain interaction | `STELLAR_RPC_URL`, network-switchable (testnet default) |
| ComplyAdvantage | KYC/AML screening (OFAC, UN, EU, PEP, adverse media) | Feature-flagged off by default |
| SendGrid | Transactional email | `SENDGRID_API_KEY`, `FROM_EMAIL` |
| Twilio | SMS notifications | `TWILIO_ACCOUNT_SID`/`AUTH_TOKEN`/`PHONE_NUMBER` |
| Sentry | Error tracking (frontend + backend) | `SENTRY_DSN`, blank disables it |
| SAR filing API | Suspicious Activity Report submission | `SAR_FILING_API_URL`/`TOKEN`, regulator/provider-specific, not wired to a named vendor |

## Key Libraries (beyond framework defaults)

- Zod (validation), React Query + React Query Devtools, Zustand, Recharts, Framer Motion, `qrcode.react`, `sonner` (toasts), `lucide-react` (icons)

## Environment Variables (names only — see `backend/.env.example` and `docs/ENVIRONMENT.md` for full reference)

Grouped by concern:
- **Core**: `PORT`, `DATABASE_URL`, `REDIS_URL`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, `LOG_LEVEL`, `DEMO_MODE`
- **Stellar/contracts**: `STELLAR_NETWORK`, `STELLAR_RPC_URL`, `STELLAR_NETWORK_PASSPHRASE`, `*_CONTRACT_ID` (one per contract), `POOL_TOKEN_ADDRESS`, `STELLAR_USDC_ISSUER`/`EURC_ISSUER`/`PHP_ISSUER`
- **Auth/RBAC**: `JWT_SECRET`, `JWT_COOKIE_NAME`, `INTERNAL_API_KEY`, `ADMIN_WALLETS`, `AGENT_WALLETS`, `AUDITOR_WALLETS`, `LENDER_WALLETS`
- **KYC/AML/compliance**: `KYC_ENFORCEMENT_ENABLED`, `COMPLYADVANTAGE_API_KEY`/`URL`/`SEARCH_PROFILE`, `AML_REPORTING_THRESHOLD`, `AML_DAILY_TX_LIMIT`, `AML_HIGH_RISK_COUNTRIES`, `SAR_FILING_API_URL`/`TOKEN`
- **Audit anchoring**: `AUDIT_ANCHOR_ENABLED`, `AUDIT_ANCHOR_CONTRACT_ID`, `AUDIT_ANCHOR_SOURCE_SECRET`
- **Loan/credit parameters**: `LOAN_MANAGER_ADMIN_SECRET`, `LOAN_MIN_SCORE`, `LOAN_MAX_AMOUNT`, `LOAN_INTEREST_RATE_PERCENT`, `CREDIT_SCORE_THRESHOLD`, `SCORE_DELTA_REPAY`/`DEFAULT`/`LATE`, `LOAN_TERM_LEDGERS`
- **Background jobs**: `SCORE_RECONCILIATION_*`, `DEFAULT_CHECK_*`, `INDEXER_POLL_INTERVAL_MS`, `INDEXER_BATCH_SIZE`, `INDEXER_FINALITY_DEPTH`, `INDEXER_LAG_ALERT_THRESHOLD`
- **Notifications**: `SENDGRID_API_KEY`, `FROM_EMAIL`, `TWILIO_*`, `NOTIFICATION_RETENTION_DAYS`, `READ_NOTIFICATION_RETENTION_DAYS`, `ADMIN_EMAIL`, `ADMIN_WEBHOOK_URL`
- **Ops**: `SENTRY_DSN`, `EXPOSE_STACK_TRACES`, `WEBHOOK_REQUEST_TIMEOUT_MS`, `DB_CONN_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`

## Hard Constraints Enforced in CI

- **Money-policy drift lock**: `money-policy.json` is the single source of truth for decimal scale/rounding/allocation; `scripts/gen-money.ts` generates matching Rust (`contracts/money/src/policy.rs`) and TS (`backend`/`frontend` `policy.generated.ts`) files, and CI (`ci.yml` → `money-policy` job) **fails the build** if any generated file has drifted from what's committed.
- **Supply-chain blocklist**: CI hard-fails if any lockfile contains `plain-crypto-js` or `axios@1.14.x` (both confirmed-malicious versions).
- Node **≥20** required (`engines` field in backend and frontend `package.json`).
- Weekly CodeQL (JS/TS + Rust), weekly OWASP ZAP DAST against staging, `cargo audit` + `npm audit` on every PR.
