# DukaPay — Target Success Metrics

> **Status**: Seed document (issue #567).  
> Quantitative targets marked **TBD** must be confirmed by a product
> owner/stakeholder — the candidates below are derived from the codebase and
> are intentionally conservative starting-points, not mandates.  
> This file is the single source of truth for "is this working?".
> Update targets here when they are agreed; link them from sprint planning and
> retros so the team has a shared bar.

---

## 0. Non-Negotiable Invariant

| Invariant | Expression | Acceptable value |
|---|---|---|
| **Solvency** | `Σ agent float ≤ Σ agent collateral × haircut` | **0 violations at all times** |

This is enforced on-chain by the `agent_vault` contract and checked off-chain
by the reconciliation service (`scoreReconciliationService`, `eventIndexer`).
Any violation is a severity-1 incident. CI/monitoring must alert on this
before any other metric.

---

## 1. Acquisition

| Metric | Definition | Instrumented in | Target (TBD) |
|---|---|---|---|
| **New borrower signups / week** | Distinct wallets completing first auth challenge → JWT | `authService`, `user_profiles` | TBD |
| **New agent activations / week** | Agents reaching `status = active` in `agent_assignments` (KYC + bond posted) | `agentRoutes`, `agent_assignments` | TBD |
| **Agent activation rate** | Active agents ÷ total registered agents | derived | ≥ 70 % within 14 days of registration |

The issue description flags **agent activation rate** as one of the two most
important product-health signals. An activation funnel drop-off (registered →
KYC → bond posted → first float tx) should be tracked as a dedicated funnel.

---

## 2. Engagement

| Metric | Definition | Instrumented in | Target (TBD) |
|---|---|---|---|
| **D30 borrower retention** | Borrowers with ≥ 1 app session in the 30 days after first login | `user_profiles.updated_at`, front-end events | TBD |
| **Loan requests per active borrower / month** | `loan_history` rows grouped by `borrower_public_key` | `loan_history` | TBD |
| **On-time repayment rate** | Repayments with `status = repaid` and `repaid_at ≤ due_date` ÷ total eligible | `loan_history` | ≥ 80 % |
| **Kingdom tier progression rate** | Borrowers who advance ≥ 1 tier within 60 days of first loan | front-end gamification, XP events | TBD |
| **Remittance volume (USD-equiv.) / week** | Sum of `remittances.amount` where `created_at` is in the window | `remittances` | TBD |
| **Average Reliability Score delta / cohort month** | Mean(`score` change) for borrowers with ≥ 1 repayment in the month | `scores.score`, `scoreDecayService` | > 0 (net positive) |

---

## 3. Risk

| Metric | Definition | Acceptable threshold |
|---|---|---|
| **Loan default rate** | `loan_history` rows with `status = defaulted` ÷ total closed loans | ≤ 5 % trailing 90 days |
| **30-day delinquency rate** | Loans where `due_date` passed and `status ≠ repaid` with `due_date` < NOW − 30d | ≤ 10 % outstanding balance |
| **Score decay events / week** | Rows inserted to the `contract_events` decay topic | Monitor for unexpected spikes; no absolute cap |
| **Solvency invariant breaches** | Count of reconciliation runs where float > collateral | **0** |
| **Disputed loans resolved ≥ 7 days** | `loan_disputes` open > 7 days | **0** (SLA: close within 7 days) |

---

## 4. Pool / Lender Health

| Metric | Definition | Target (TBD) |
|---|---|---|
| **Pool utilisation** | Outstanding loan principal ÷ pool total deposits | 40 – 80 % (below 40 % = idle capital; above 80 % = liquidity risk) |
| **Annualised pool yield** | Interest collected ÷ avg deposits × 365 | TBD (driven by interest rate; benchmark against stablecoin yields) |
| **Pool withdrawal latency** | Time from withdrawal request to settlement | ≤ 1 Stellar ledger (≈ 5 s) for amounts within available liquidity |

---

## 5. Compliance & Privacy

| Metric | Definition | Target |
|---|---|---|
| **DSAR completion time** | `dsar_requests.resolved_at − created_at` | **≤ 30 calendar days** (GDPR Art. 12) |
| **Erasure request completion time** | Same, for erasure-type DSARs | **≤ 30 calendar days** |
| **PII access log coverage** | % of endpoints that touch PII fields and log to `pii_access_log` | 100 % |
| **KYC gating coverage** | % of loan-request paths behind `KYC_ENFORCEMENT_ENABLED` guard | 100 % (when flag is on) |
| **SAR filings within regulatory window** | `sar_reports` filed ≤ 30 days after suspicion trigger | 100 % |
| **Audit anchoring latency** | `audit_epochs` committed ≤ configured anchor interval | 0 missed epochs (when `AUDIT_ANCHOR_ENABLED=true`) |

---

## 6. System Health

| Metric | Definition | SLO |
|---|---|---|
| **API p99 latency** | 99th-percentile response time for `/api/score/*`, `/api/loans/*` | ≤ 500 ms |
| **Indexer lag** | `NOW() − MAX(ledger_closed_at)` in `indexed_events` | ≤ 60 s |
| **Webhook delivery success rate** | `webhook_deliveries` with `status = delivered` ÷ total attempted | ≥ 99 % |
| **Quarantine event backlog** | Rows in `quarantine_events` unreviewed > 24 h | 0 |
| **Pool connection error rate** | `connect` event errors in `connection.ts` (statement_timeout failures) | 0 (fixed by #560) |
| **Unhandled promise rejections / hour** | Process-level `unhandledRejection` count | 0 |

---

## 7. Instrumentation Pointers

The following existing code surfaces can feed a monitoring dashboard without
new instrumentation:

| Data source | Metrics |
|---|---|
| `scores` table (`score`, `updated_at`) | Score growth, decay velocity |
| `loan_history` (`status`, `repaid_at`, `due_date`) | Default rate, on-time rate |
| `remittances` (`amount`, `created_at`) | Remittance volume |
| `dsar_requests` (`created_at`, `resolved_at`, `type`) | DSAR SLA compliance |
| `audit_epochs` (`committed_at`) | Anchoring gap detection |
| `webhook_deliveries` (`status`, `attempted_at`) | Delivery success rate |
| `quarantine_events` (`quarantined_at`) | Indexer health |
| `agent_assignments` (`created_at`, agent `status`) | Agent activation funnel |
| `contract_events` topic = `decay` | Score decay volume |

Recommended next step: wire the above tables into a Grafana / Metabase dashboard
with alerts on the **0-tolerance** metrics (solvency breach, DSAR SLA overrun,
open disputes > 7 days).

---

## 8. Open Decisions (requires stakeholder input)

- [ ] Set numeric targets for all **TBD** cells above.
- [ ] Confirm the definition of "active agent" (any float tx? or minimum volume?).
- [ ] Agree on the KPI review cadence (weekly? fortnightly sprint retro?).
- [ ] Decide whether `circuit_breaker` and `settlement-netter` contracts are in-scope for the current success window (both are currently incomplete — see PRD §"Nice to Have").
- [ ] Define the cohort window for retention and tier-progression metrics.

---

*Document derived from codebase inspection (issue #567). Maintainers: keep
this file in sync with actual monitoring infrastructure. File path:
`docs/SUCCESS_METRICS.md`.*
