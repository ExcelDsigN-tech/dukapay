# DukaPay Architecture

DukaPay is an on-chain agent-banking float & settlement protocol on Stellar. This document describes the system at the level needed to work on it: what lives on-chain, what lives off-chain, and why that split exists.

## 1. Domain model

### Actors

| Role | Description |
|------|-------------|
| **Agent** | Local shop owner. Holds float (cash + e-money), converts one into the other. KYC'd and bonded. |
| **Operator** | Trusted backend role (DukaPay deployment). Onboards agents, runs settlement, adjudicates disputes. |
| **Customer** | Unbanked cash user. Hands cash to an agent, receives stablecoin (or mobile-money credit), and back. |
| **Regulator** | Read-only. Verifies solvency: Σ float ≤ Σ collateral. |
| **Owner** | Contract deployer/admin. Sets operator, global params. |

### Core concepts

- **Collateral** — USDC locked by an agent as backing for issued e-money. Stable by construction, so no oracle.
- **Float** — on-chain liability owed by the agent to customers (e-money in circulation). Governed by `float ≤ collateral × haircut`.
- **Haircut** — solvency buffer parameter (e.g. 0.8 means float can be at most 80% of collateral).
- **Bond** — additional USDC locked at onboarding to guarantee agent behavior; frozen while the agent carries float.
- **Batch** — a time-windowed set of transactions that net to zero and finalize atomically.

## 2. On-chain / off-chain split

| Layer | Where | Why |
|-------|-------|-----|
| Float ledger, collateral, bonds, agent registry, net settlement, disputes | **On-chain** (Soroban contracts) | Multi-party trust with real money — needs shared, auditable, immutable state. Collateralization and net settlement are consensus problems, not CRUD problems. |
| KYC document checks, mobile-money operator adapters, dispute evidence, maps, dashboards | **Off-chain** (backend + frontend) | Private, regulatory, or UX concerns — not money movement. |

Trade-off named: **permissioned** agent registration (KYC'd + bonded agents, operator role) is the default. Permissionless onboarding is a later option, not the default — unlicensed agents would be an AML disaster and no operator would deploy it.

## 3. Smart contracts

Three Soroban contracts under `contracts/`. All use checked arithmetic; all external token movement goes through an internal `token_client` (USDC).

### 3.1 `agent-registry`

- Storage: `Agent(addr) → AgentInfo { status, kyc_ref, bond_amount, license_expiry, region, reputation }`; owner; operator.
- Functions: `register(kyc_ref, region, bond)`, `activate`, `suspend`, `set_reputation`, `renew_license`, `top_up_bond`, `withdraw_bond`.
- Invariants:
  - No active agent without a bond and a `kyc_ref`.
  - Bond frozen while the agent carries float (enforced on the withdraw path; `agent-vault` refuses `withdraw_bond` while `float > 0`).
- Events: `AgentRegistered`, `AgentStatusChanged`, `BondUpdated`.

### 3.2 `agent-vault`

- Storage: `Vault(addr) → { collateral, float, haircut, last_settled }`; global `Params { max_haircut, min_collateral }`.
- Functions: `deposit_collateral`, `withdraw_collateral`, `mint_float` (cash-in), `burn_float` (cash-out), `transfer_float(to, amt)` atomic, `settle_net(entries)`.
- Invariants:
  - `float ≤ collateral × haircut` at every commit.
  - `collateral ≥ min_collateral`.
  - On net settlement: Σ entries = 0, every resulting float stays within bounds.
- Risk mitigations: collateral is USDC (no price-feed risk); cross-contract calls only via internal `token_client`; bounded batch sizes (no storage DoS).

### 3.3 `settlement-netter` *(P2)*

- Storage: `Batch(id) → { txns, status, window_end, net_positions }`.
- Functions: `open_batch`, `submit_txn` (operator-signed), `net`, `finalize` (atomic vault transfers), `raise_dispute`.
- Invariants: batch finalized exactly once; Σ debits = Σ credits; finalize only after dispute window closes.

## 4. Data flow

```
Cash-in:  Customer cash → Agent
          → agent signs CashInEvent (backend verifies, rate-limited)
          → backend calls AgentVault.mint_float + issues USDC to customer wallet
          → event → indexer → Postgres → dashboard shows float/collateral live

Settlement: backend collects txns in time-window
          → SettlementNetter.submit_txn (signed)
          → net() computes net positions
          → finalize() atomically moves float between vaults
          → event → indexer → audit API

Dispute:   any party raises dispute within window
          → position held in netter
          → operator adjudicates off-chain, resolves on-chain
```

## 5. Storage layout (contracts)

- **Instance storage**: global params, operator, owner.
- **Persistent storage**: per-agent/per-vault records keyed by `Address`.

## 6. Off-chain services

- **backend/ (Express 5, TS)**: auth (JWT), onboarding + KYC adapter, transaction API (cash-in/out), settlement service, rate limiting, zod validation at the boundary. Postgres via `node-pg-migrate`; Redis cache; Sentry; prom-client metrics.
- **indexer/ (Rust → Postgres)**: consumes contract events, materializes audit queries and live dashboards. *(P2)*
- **frontend/ (Next.js 16)**: agent dashboard (float, collateral, status), admin console, find-an-agent map.

## 7. Security model

- Access control reviewed on every contract function: owner / operator / agent.
- No unsigned state writes: `submit_txn` is operator-signed.
- Input validation at every API boundary (zod); `express-rate-limit` on all endpoints.
- Secrets only in env; non-root containers; no hardcoded keys.
- Solvency invariant (`Σ float ≤ Σ collateral`) is property-tested.

## 8. Deployment & observability

- Staging via GitHub Actions; `docker-compose` for local/staging parity.
- Sentry (frontend + backend), pino structured logs, prom-client metrics (txn throughput, batch latency, float ratio), health endpoints.
