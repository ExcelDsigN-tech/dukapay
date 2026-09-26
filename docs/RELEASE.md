# Mainnet Release & Go-Live Checklist

This document specifies the go-live success criteria, hard pause triggers, soft rollback procedures, and governance authority assignments for DukaPay mainnet releases.

---

## 1. Product Go-Live Success Criteria

Mainnet deployment success is evaluated against product operational targets over the first 30 days post-launch (building upon general metrics defined in #567):

- **User Onboarding & Adoption**:
  - Minimum **5,000 verified borrowers** onboarded within 30 days of mainnet launch.
  - Minimum **100 registered liquidity agents** active across target operating corridors.
- **Loan Volume & Performance**:
  - Target **$500,000 USD equivalent** in cumulative loan disbursements.
  - Loan default rate retained **below 1.0%** during the initial 30-day window.
  - 30-day repeat borrower retention rate target of **≥ 60%**.
- **System Performance & Reliability**:
  - API Availability: **≥ 99.9% uptime** across backend services.
  - Transaction Latency: P95 backend response time **< 300ms**; P99 response time **< 1,000ms**.
  - Zero unhandled security incidents or unauthorized state mutations.

---

## 2. Hard Pause Triggers (Circuit Breaker)

Hard pause triggers are non-negotiable security and financial safety conditions. When any hard pause condition is met, the system MUST transition immediately to a paused state via `MultisigGovernance` and the smart contract `CircuitBreaker`. **Hard pauses are automatic or immediate manual actions, never "monitor-and-wait" situations.**

### 2.1 Solvency Invariant Violations (Critical)
- **Condition**: $\sum \text{Agent Float} > \sum \text{Agent Collateral}$ for any registered agent or system pool.
- **Trigger**: Any detected imbalance where total outstanding float allocated to an agent exceeds their verified collateral deposit.
- **Action**: Immediate execution of `CircuitBreaker::pause_all()` or function-level pause (`pause_float_transfers`).

### 2.2 Smart Contract Anomaly & Exploit Triggers
- **Condition**: Unexpected depletion of `LendingPool` reserves (> 15% net outflow in < 10 minutes without matching user loan requests).
- **Condition**: Re-entrancy attempt or failed contract invariant assertion reported by indexer.
- **Action**: Immediate emergency trip on affected contract module (`LendingPool`, `AgentVault`, `LoanManager`).

### 2.3 External Infrastructure & Oracle Failures
- **Condition**: Soroban RPC / Stellar Horizon network partition or blackout exceeding 15 minutes.
- **Condition**: FX rate oracle drift exceeding **5%** variance from secondary price source within 10 minutes.
- **Action**: Pause new loan originations and float transfers until oracle feeds re-synchronize.

---

## 3. Soft Rollback Criteria (Deploy Pipeline)

Soft rollback triggers pertain to the production deployment pipeline (`infra/scripts/rollback-blue-green.sh`). If post-deployment canary checks or initial traffic routing violate quality gates, an automated or manual blue-green rollback is executed.

### 3.1 Pipeline Rollback Thresholds
- **HTTP 5xx Error Rate**: `> 1.0%` of total requests over a rolling 5-minute window post-deploy.
- **Latency Spikes**: P99 response time `> 2,000ms` sustained over 5 consecutive minutes.
- **Container Health Check Failures**: `> 25%` of backend instances failing readiness probes (`/health/deep`).
- **Database Migration Failure**: Unhandled error or deadlock during `npm run migrate` execution.
- **Indexer Sync Lag**: Event indexer falling `> 100 ledgers` behind Stellar mainnet tip post-deploy.

### 3.2 Rollback Execution Command
```bash
# Execute automated blue-green rollback to previous stable deployment version
./infra/scripts/rollback-blue-green.sh --environment production --target previous-stable
```

---

## 4. Governance & Operational Authority

Explicit authority is assigned to named operational roles to prevent ambiguity during high-stress incidents.

| Role | Assigned Authority | Actions Permitted | Target Response SLA |
| :--- | :--- | :--- | :--- |
| **Emergency Response Lead (On-Call)** | Immediate Breaker Trip | Trip `CircuitBreaker::pause_all()` or module-specific pause | **< 5 minutes** |
| **Security Champion / Lead** | Incident Escalation & Trip | Trip emergency pause, freeze PII key rotation | **< 5 minutes** |
| **DevOps Lead / Site Reliability** | Pipeline Rollback | Execute `rollback-blue-green.sh`, revert DB migrations | **< 15 minutes** |
| **Multisig Governance (3-of-5 Signers)** | Pause Lifting & Contract Upgrades | Approve `execute_override()`, lift circuit breaker, execute Wasm upgrade proposals | **< 2 hours** |

### 4.1 Response Time Expectations
- **P0 Solvency / Security Incident**: Acknowledged and paused within **5 minutes**.
- **P1 Deployment Degradation**: Soft rollback initiated within **15 minutes**.
- **Post-Incident Unpause**: Requires 3-of-5 multisig sign-off following root cause analysis (RCA).

---

## 5. Mainnet Launch Checklist

- [ ] **Pre-Flight Verification**:
  - [ ] All unit, integration, and e2e tests passing in CI (`npm test`, `cargo test`).
  - [ ] Security audit findings remediated and threat model (`.github/THREAT_MODEL.md`) signed off.
  - [ ] Deployer keys secured in HSM / MPC environment per `docs/security/key-management.md`.
- [ ] **Contract Deployment**:
  - [ ] Wasm artifacts compiled cleanly and hashes verified.
  - [ ] 3-of-5 `MultisigGovernance` proposal submitted and executed on mainnet.
  - [ ] Contract IDs recorded in `docs/deployed-contracts.md`.
- [ ] **Circuit Breaker Wiring**:
  - [ ] `CircuitBreaker` contract initialized with authorized signer addresses.
  - [ ] `set_circuit_breaker` invoked for `LendingPool`, `AgentVault`, and `LoanManager`.
  - [ ] Smoke test performed: emergency pause verified and override flow tested.
- [ ] **Blue-Green Deployment & Canary**:
  - [ ] Production backend deployed behind blue-green load balancer.
  - [ ] 5% canary traffic routed; error rate and latency monitored for 15 minutes.
  - [ ] 100% traffic cutover completed.
- [ ] **Post-Deploy Monitoring**:
  - [ ] Real-time alerts active for solvency invariant monitors.
  - [ ] Grafana / Prometheus dashboards operational for API latency and error rates.
  - [ ] On-call rotation active with clear escalation path to Emergency Response Lead.
