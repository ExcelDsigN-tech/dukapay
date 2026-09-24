# DukaPay — Backend Schema (Reverse-Engineered)

> Source of truth: `backend/migrations/*.cjs` (49 migrations, `node-pg-migrate`). **No raw `.sql` files are executed** — a comment in `package.json` explicitly warns against adding them to `src/db/`.

## Tables (created via migrations, grouped by concern)

**Core domain**
- `scores` — on-chain credit/reliability score cache
- `remittance_history`, `remittances` — remittance records
- `loan_events`, `loan_history` — event-sourced + materialized loan state
- `user_profiles` — off-chain profile data keyed to wallet address

**Agent banking**
- `agent_float_transfers`, `agent_float_transfer_limits`, `agent_float_transfer_approvals` — agent-to-agent float rebalancing (backs `agentFloatRoutes.ts`)

**Indexer / event processing**
- `indexer_state`, `indexed_events`, `quarantine_events` (malformed/suspicious events held for review), `cross_contract_reconciliation`, `ledger_checkpoints` (reorg-safe checkpointing)

**Compliance / audit**
- `compliance_profiles`, `compliance_audit_log`, `transaction_monitoring_alerts`, `sar_reports` (Suspicious Activity Reports), `pii_access_log`, `dsar_requests` (data subject access requests), `audit_logs`, `audit_epochs` + `audit_merkle_leaves` (tamper-proof, Merkle-anchored audit trail)

**Transactions / ops**
- `transaction_submissions`, `decay_events` (score decay over time), `webhook_subscriptions`, `webhook_deliveries`

**User-facing**
- `notifications`, `user_notification_preferences`

> A `users` base table is **not** explicitly created by name in any migration's `createTable` call — identity is wallet-address-centric, and `user_profiles` appears to be the closest thing to a users table. Confirm with the schema directly (`\d user_profiles`) before assuming a canonical `users` table exists.

## Relationships

Not centrally documented — inferred from naming and RLS join logic:
- `loan_history`/`loan_events` reference a wallet/borrower identity (not necessarily a `users.id` FK — likely a `borrower_wallet` text column, consistent with wallet-based auth).
- `agent_float_transfer_approvals` → `agent_float_transfers` (approval workflow on a transfer record).
- `agent_assignments` (referenced by RLS policies, table not in the createTable grep above — likely created inline within the RLS migration or an earlier one; **verify directly** rather than trust this doc blindly) maps borrowers to their assigned agent, used to scope agent-role visibility.
- `audit_merkle_leaves` → `audit_epochs` (leaves batched into epochs for anchoring).

> If you're about to write a migration that adds a new FK, run `\d+ <table>` in psql first — this doc lists tables, not verified column-level FK constraints.

## Auth Model

- **No password-based users table.** Identity = Stellar wallet public key.
- Login: challenge/response signature (`POST /auth/challenge` → `POST /auth/login`) → JWT issued as httpOnly cookie (`JWT_COOKIE_NAME=dukapay_jwt`).
- **Role resolution is env-driven, not DB-driven**: `backend/src/auth/rbac.ts` checks the authenticated wallet against `ADMIN_WALLETS` / `AGENT_WALLETS` / `AUDITOR_WALLETS` / `LENDER_WALLETS` (comma-separated public keys in env). Unlisted wallets default to `borrower`.
- 5 roles exist in code: `admin`, `agent`, `borrower`, `auditor`, `lender` (legacy alias, functionally close to `agent` for read scopes — comment in source says "new integrations should use `agent`").
- Role hierarchy for "at least" comparisons: `admin(4) > agent(3) ≈ lender(3) > auditor(2) > borrower(1)`.
- Scopes per role are explicit string lists (e.g. `read:loans`, `write:pool`, `admin:all`) enforced by `middleware/rbac.ts` at the route layer.

## Row-Level Security (Postgres layer — `enable-rls` migration)

- RLS enabled on every business table via dynamic `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (looped over table list at migration time).
- Claims resolved from either `request.jwt.claims` (Supabase-compatible) or `app.claims.*` session GUCs (self-hosted — the backend sets these explicitly per request).
- Policy shapes seen in the migration:
  - **Admin**: `FOR ALL USING (dukapay_request_is_admin())` — unrestricted.
  - **Owner-row policies**: `(<owner_column> = dukapay_request_wallet()) OR dukapay_request_is_auditor()` — borrower sees own rows, auditor sees all (read-only, enforced by `FOR SELECT`, not `FOR ALL`).
  - **Agent-scoped policies**: `dukapay_request_is_agent() AND EXISTS (SELECT 1 FROM agent_assignments WHERE agent_public_key = wallet() AND <condition>)` — agents see only rows for borrowers explicitly assigned to them.
  - **Auditor-only policies**: `FOR SELECT USING (dukapay_request_is_auditor())` — read-only, no write policy exists for auditor by design.
- **Important, documented-in-source caveat**: RLS is **not forced** (`FORCE ROW LEVEL SECURITY` is deliberately not applied), because the application's DB user owns the tables and would otherwise bypass RLS anyway. RLS here is defense-in-depth for direct-DB/Supabase-style clients; the actual enforcement for the API surface is `backend/src/middleware/rbac.ts`. **This is intentional, not a gap** — don't "fix" it by forcing RLS without understanding this tradeoff first.
- **Discrepancy to flag**: RLS policies map to 4 roles (`borrower`, `agent`, `auditor`, `admin`); the `lender` role from `rbac.ts` has no distinct RLS policy family — it likely inherits agent-shaped policies implicitly, or falls through to default-deny. Verify explicitly if you're building anything lender-specific that touches RLS-protected tables.

## Sensitive Fields

- PII field encryption exists (migration `pii-field-encryption`) — column-level encryption for PII, keyed via `PII_KEK_*` env vars (KMS-backed key encryption key).
- `pii_access_log` table — every PII read is logged (audit trail).
- Secrets (JWT signing, contract admin keys) live only in env vars, never in the DB.

## File/Media Storage

**Not found** — no object storage integration (S3/GCS/Supabase Storage) referenced in backend dependencies or migrations. If avatars/documents/KYC uploads are handled, they're either not yet built or handled entirely by the third-party KYC provider (ComplyAdvantage) rather than stored locally.

## Webhooks / Event Triggers

- `webhook_subscriptions` + `webhook_deliveries` tables — outbound webhook system with retry logic (migration `webhook-retry-logic`, `webhook-max-attempts`).
- Admin endpoints to manage them: `GET/DELETE /admin/webhooks`, `GET /admin/webhooks/:id/deliveries` (`adminRoutes.ts`).
- Inbound: none found (no incoming webhook receiver route, e.g. for a payment provider) — outbound-only as currently built.

## API Endpoints (by domain — see live Swagger UI at `/docs` for the exhaustive, authoritative list)

| Domain | Route file | Examples |
|---|---|---|
| Auth | `authRoutes.ts` | `POST /auth/challenge`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/csrf`, `POST /auth/kyc`, `GET /auth/verify`, `POST /auth/logout` |
| Agents | `agentRoutes.ts`, `agentFloatRoutes.ts` | register/list/deactivate agent; float transfer request/approve/status |
| Loans | `loanRoutes.ts` (largest route file, 20 endpoints) | create, repay, extend, refinance, cancel, contest-default, mark-defaulted, config |
| Pool | `poolRoutes.ts` | deposit, withdraw, analytics, stats |
| Remittances | `remittanceRoutes.ts` | send, list, status |
| Score | `scoreRoutes.ts` | get score, leaderboard, history |
| Notifications | `notificationsRoutes.ts` | list, preferences, stream (SSE), mark-read/mark-all-read |
| Users | `userRoutes.ts` | profile get/patch |
| Transactions | `transactionRoutes.ts` | `GET /transactions/me` |
| Events | `eventRoutes.ts` | `/stream` (SSE), `/status` |
| Indexer | `indexerRoutes.ts` | status, recent events, webhooks |
| Privacy | `privacyRoutes.ts` | DSAR request/status |
| Audit | `auditRoutes.ts` | audit log query |
| Simulation | `simulationRoutes.ts` | scenario simulation (likely loan/interest projections) |
| Status | `statusRoutes.ts` | `GET /api/status/pause` (circuit-breaker/pause state) |
| Admin | `adminRoutes.ts` (largest, 14+ endpoints) | disputes, governance approval, audit logs, quarantine events, webhooks |
