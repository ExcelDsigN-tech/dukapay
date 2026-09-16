# DukaPay — Implementation Plan (Reconstructed from Git History + Current State)

> This is not a forward-looking plan for a new build — DukaPay is live with 500+ commits and many contributors. This document reconstructs the phases that actually happened (so new contributors understand *why* the code is shaped this way) and lists the phases still open.

## How it was actually built

### Phase 0 — Scaffold (earliest commits)
`feat: scaffold project structure (frontend, backend, contracts)` → Dockerization → basic pages. Monorepo shape (contracts/backend/frontend split) was decided immediately, before feature work.

### Phase 1 — Community-driven contract & feature build-out
Git history shows this was **open-source, bounty/issue-driven development** with many distinct contributor usernames merging PRs (`Uchechukwu-Ekezie`, `Wilfred007`, `Samuel1505`, `Adedayo-Data`, `Gbangbolaoluwagbemiga`, `jerrygeorge360`, `njohnchi`, `Spagero763`, and more) — not a single team building sequentially. Representative work in this phase:
- `remittance_nft` contract: minting, metadata, authorization, backward-compatible data migration
- `loan_manager` contract: unit test coverage, deposit logic
- `lending_pool` contract: native asset deposits, withdraw + balance checks, event emission
- Swagger/OpenAPI documentation integrated early
- Health-check endpoint

This explains the current repo's shape: feature completeness varies contract-to-contract because each was driven by different contributors/bounty issues, not one architect's plan — which is also why top-level docs (ARCHITECTURE.md, CONTRACTS.md) drifted out of sync with what got built (see Open Items below).

### Phase 2 — Security hardening wave (most recent ~60 commits)
A concentrated, clearly deliberate hardening pass, referencing a formal issue-tracking scheme (`#452`–`#491`):
- Zero trust + incident response + secure SDLC (#474)
- Security issues #453/#461/#462/#465 batch
- Redis caching, state reconciliation, MEV protection, call safety (#481)
- Standalone Rust indexer, TypeScript SDK, env drift sweep, contract upgrade timelock (#482)
- Ops/CI/infra enhancements (#483)
- Parameterized queries audit, XSS prevention, secrets management (#484)
- PII rotation, JWT refresh rotation, CSRF, tiered rate limiting (#485)
- OpenAPI ↔ implementation alignment, deployed-contract registry (#487)
- Oracle price-feed manipulation protection, backend perf, frontend budgets (#488)
- Emergency circuit breaker, contributor wiki, key management, formal verification (#478)
- **Row-Level Security + RBAC for tenant isolation (#490)** — most recent major merge before current HEAD
- Agent-to-agent float transfer feature (#479), immediately followed by a CI cleanup fix (#491)

This phase reads as a project moving from "feature-complete MVP" to "production-hardening for real money," consistent with the bug bounty program and annual pentest commitments in `SECURITY.md`.

## Current Build Order (for a new contributor setting up locally)

1. **Setup**: `docker compose up --build` (Postgres 16.9, Redis 7.4, backend, frontend) — or manual `npm install` per component + `cp .env.example .env`.
2. **Database**: `npm run migrate:up` (49 migrations run in order; RLS is enabled as one of the last migrations, so a fresh DB gets it automatically).
3. **Contracts**: `cargo build --target wasm32-unknown-unknown --release && cargo test` in `contracts/` — 9 workspace members build together.
4. **Auth**: wallet-based, no signup form to build — set `ADMIN_WALLETS`/`AGENT_WALLETS`/etc. in `.env` for local role testing.
5. **Core features**: loans → pool → remittances → score/gamification → agent float — in the codebase's own rough order of maturity (loans and pool have the deepest test coverage and largest route files; gamification/Kingdom is the newest, least-covered-by-tests surface).
6. **UI polish**: Lighthouse budgets and a11y audits are already enforced in CI — don't skip `npm run audit:a11y` / `npm run perf:budget` on frontend changes.
7. **Testing**: Jest (backend + frontend unit), Playwright (frontend e2e), `cargo test` + `proptest` fuzz (contracts), k6-style load tests (`tests/load/`).
8. **Deploy**: staging via GitHub Actions + Docker Compose staging config; blue-green deploy scripts + Terraform + Kubernetes for infra-as-code; no PaaS (Vercel/Railway) target found.

## Open Items (things a human maintainer needs to decide — not code-derivable)

1. **`settlement-netter`**: named in ARCHITECTURE.md, doesn't exist as a contract. Decide: was this superseded by `agent_vault.settle_net`, or is it still-unbuilt scope? Update ARCHITECTURE.md either way.
2. **`circuit_breaker` contract**: has source + tests but sits outside the Cargo workspace (`contracts/Cargo.toml` members list). Confirm whether it's deployed independently, mid-integration, or abandoned — then either add it to the workspace or document why it's separate.
3. **`E2E_IMPLEMENTATION_SUMMARY.md`**: 0 bytes. Either fill it in or delete it — an empty root-level doc is worse than none.
4. **Two design languages** (neutral shell vs. Obsidian/Kingdom palette, see UI/UX brief): confirm whether they're meant to converge.
5. **`lender` role's RLS coverage**: RBAC defines it, RLS policies don't have a distinct family for it — verify before building anything lender-facing that touches RLS-protected tables.
6. **KYC/AML and audit-anchor enforcement are both off by default** (`KYC_ENFORCEMENT_ENABLED=false`, `AUDIT_ANCHOR_ENABLED=false`) — confirm target launch state before treating either as "done."
7. **Success metrics** (PRD gap): no target signup/loan-volume/retention numbers exist anywhere in the repo — needs a product decision, not more code archaeology.

## "Done" Criteria (inferred from what CI already gates — treat these as the current bar, not aspirational)

- All CI workflows green: `ci.yml` (supply-chain audit, money-policy drift check, presumably build/lint/test), `codeql.yml`, `dast.yml`, `verify-contracts.yml`, `drift-check.yml`.
- `cargo test` passes across all 9 workspace contracts, plus fuzz suite for `agent_vault`.
- Lighthouse budget (`lighthouse-budget.json`) and a11y audit pass for any frontend change.
- No RLS/RBAC regressions — the RBAC test suite (`tenantAccessRbac.test.ts`, `agentRbac.test.ts`, `poolRouteScopes.test.ts`, `indexerRouteScopes.test.ts`) must stay green.
- OpenAPI spec (`backend/src/swagger/openapi.json`) kept in sync with implementation (there's a dedicated CI concern for this per commit #487).
