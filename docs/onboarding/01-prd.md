# DukaPay — Product Requirements Document (Reverse-Engineered)

> This PRD documents DukaPay **as it currently exists in code**, not as originally pitched. Where the shipped product has outgrown or diverged from the README/marketing description, that divergence is called out explicitly rather than smoothed over.

## App Name & Tagline

**DukaPay** ("duka" = shop, Swahili) — originally framed as an on-chain agent-banking float & settlement protocol for unbanked cash economies. In practice, the shipped product is broader: **a Stellar/Soroban DeFi lending, remittance, and agent-banking platform with a gamified borrower experience.**

## Problem

Two problems are actually being solved by the shipped code, not one:

1. **Agent banking / cash liquidity** (the original pitch): unbanked users need a trusted way to convert cash to stablecoin and back through a local agent, with solvency enforced on-chain instead of by an unaudited private ledger.
2. **DeFi lending & credit-building** (what most of the frontend and backend routes actually serve): borrowers take collateralized loans against a lending pool, build an on-chain "Reliability Score" (credit score) over time, and are retained via a gamified "Kingdom" progression system (XP, tiers, quests, achievements).

These are related (float/collateral is the backbone; loans and remittances are built on top) but the product surface is materially larger than "agent cash-in/cash-out."

## Core Value Proposition

- Solvency is **enforced on-chain** (`float ≤ collateral × haircut`), not promised by a bank — auditable by anyone, including regulators (read-only proof).
- Credit access for users with no formal credit history, via an on-chain, portable credit score (`remittance_nft` contract + score reconciliation service).
- A gamification layer (XP, tiers "Apprentice → Sovereign → Exalted", quests, achievement badges) intended to drive repayment behavior and retention — this is a first-class product bet, not a cosmetic skin (see `frontend/src/app/[locale]/kingdom/`, `components/gamification/`).

## Target User Persona

Two personas are actually served by the code:

- **The Agent**: a local shop owner, KYC'd and bonded, who provides cash-in/cash-out liquidity and earns from float spread. Technical enough to use a wallet (Freighter), not necessarily banked themselves.
- **The Borrower**: an unbanked-or-underbanked individual seeking small collateralized loans, building a reputation/credit score over time, engaged by gamified progress feedback (quests, XP, tier unlocks).

A third, thinner persona exists in the code but isn't described in any product doc: the **Lender/Pool provider** (`lender` role in RBAC — legacy alias for `agent`) who deposits into the lending pool for yield.

## Core Features — Shipped (Must Have, verified in code)

- Agent onboarding with KYC reference + USDC bond (`agent_registry` contract, `agentRoutes.ts`)
- Cash-in/cash-out float minting/burning with enforced solvency invariant (`agent_vault` contract)
- Agent-to-agent float transfer (`agentFloatRoutes.ts`, contract `transfer_float`)
- Collateralized loan lifecycle: request, repay, extend, refinance, cancel, contest-default, mark-defaulted (`loanRoutes.ts`, `loan_manager` contract, `LoanApplicationWizard.tsx`)
- Lending pool: deposits, withdrawals, yield/share price, emergency withdraw (`poolRoutes.ts`, `lending_pool` contract)
- On-chain credit/reliability score with leaderboard, decay events, and reconciliation job (`scoreRoutes.ts`, `remittance_nft` contract, migration `create-decay-events`)
- Cross-border remittance sending (`remittanceRoutes.ts`, `RemittanceForm.tsx`)
- Gamification: XP, achievements, Kingdom tier roadmap, level-up modal (`components/gamification/`)
- Multi-channel notifications (in-app stream, email via SendGrid, SMS via Twilio) with user preferences
- Admin console: dispute adjudication, contract-upgrade governance approval, audit log viewing, webhook management, indexer quarantine-event review
- Wallet-based auth (challenge/response + Stellar signature, JWT + refresh rotation + CSRF), 5-role RBAC (admin/agent/borrower/auditor/lender)
- Compliance: KYC/AML gating (ComplyAdvantage integration, feature-flagged off by default), DSAR (data subject access request) handling, PII field encryption, tamper-proof audit anchoring
- Contract upgrade governance: 3-of-5 multisig, 48h timelock, emergency pause/circuit breaker

## Nice to Have / Partial / In-Progress

- `settlement-netter` — described in ARCHITECTURE.md as a batched net-settlement contract; **no such contract exists in the codebase.** Either dropped, renamed into `agent_vault.settle_net`, or never built — needs a maintainer decision (see Implementation Plan, Open Items).
- `circuit_breaker` contract — has source and tests but is **not in the Cargo workspace**, so it isn't built/tested by default `cargo test`. Unclear if deployed separately or abandoned mid-integration.
- `oracle` contract — exists, has price-feed manipulation protections per commit history, but no product doc describes what it's for (likely future collateral types beyond USDC).
- KYC/AML enforcement is present but **disabled by default** (`KYC_ENFORCEMENT_ENABLED=false`) — currently opt-in, not a hard requirement.
- Audit anchoring is present but disabled by default (`AUDIT_ANCHOR_ENABLED=false`).

## Out of Scope (as of current version)

- Permissionless agent onboarding (explicitly named as a *future* option in ARCHITECTURE.md, not built — registration is operator-gated).
- Non-USDC collateral types in `agent_vault` (single-asset by design — "no price-feed risk" is a stated architectural choice).
- Mainnet deployment automation — env defaults (`STELLAR_NETWORK=testnet`) and CI/deploy scripts target testnet/staging; no evidence of a production mainnet deploy pipeline in this repo.

## User Stories (reconstructed from shipped features)

- As an **agent**, I want to register with KYC and a bond so that I can become an active cash-in/cash-out point.
- As an **agent**, I want to transfer float to another agent so that I can rebalance liquidity without moving cash.
- As a **borrower**, I want to request a collateralized loan so that I can access capital without a bank.
- As a **borrower**, I want to see my Reliability Score and Kingdom tier so that I understand my standing and am motivated to repay on time.
- As a **borrower**, I want to send a remittance so that I can move value across borders cheaply.
- As a **lender/pool provider**, I want to deposit into the lending pool so that I earn yield from borrower interest.
- As an **auditor/regulator**, I want read-only access to float, collateral, and audit logs so that I can verify Σ float ≤ Σ collateral without trusting the operator.
- As an **admin**, I want to adjudicate disputes and approve contract upgrades so that governance stays accountable and slow-changing.

## Success Metrics

Defined in **[`docs/SUCCESS_METRICS.md`](../SUCCESS_METRICS.md)** (issue #567).

Key categories:
- **Solvency invariant** — `Σ float ≤ Σ collateral × haircut` (0 violations, always)
- **Acquisition** — new borrower signups/week, agent activation rate (target ≥ 70 % within 14 days)
- **Risk** — loan default rate (≤ 5 % trailing 90 days), 30-day delinquency (≤ 10 %)
- **Compliance** — DSAR resolution ≤ 30 calendar days, 0 open disputes > 7 days
- **System health** — API p99 ≤ 500 ms, indexer lag ≤ 60 s, 0 unhandled rejections

Quantitative targets marked TBD in that file require sign-off from a product owner/stakeholder.
