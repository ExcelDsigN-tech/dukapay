# System Threat Model & STRIDE Analysis

This threat model documents the trust boundaries, threat surface, potential attack vectors, mitigations, and verification strategies for the DukaPay core platform, smart contracts, backend API services, and PII encryption infrastructure.

---

## 1. Scope and System Data Flow

- **Feature or Change**: Core DukaPay Platform Threat Model (Smart Contracts, Backend API, PII Encryption, Agent Float Multisig, Governance)
- **Owner**: Security Champion & Lead System Architect
- **Components and Trust Boundaries**:
  - **Client Applications / Web Frontends**: Browser & Mobile UI (Untrusted boundary)
  - **Backend API Gateway (Express Node.js)**: Public REST endpoints, JWT auth, rate limiters (Semi-trusted boundary)
  - **Data Stores**: PostgreSQL Database (PII envelope encrypted), Redis Cache (Rate-limit & session state) (Trusted boundary)
  - **Blockchain Layer**: Stellar Horizon & Soroban Smart Contracts (`LendingPool`, `AgentVault`, `MultisigGovernance`, `CircuitBreaker`) (Publicly readable, immutable state machine boundary)
- **Data Stores and External Services**:
  - PostgreSQL (Persistent ledger metadata, encrypted PII, audit logs)
  - Redis (Transient state, rate limits, session tokens)
  - Soroban RPC / Stellar Horizon Nodes (On-chain state execution)
- **Sensitive Data Involved**:
  - User PII (Names, Email, Phone Numbers, Physical Addresses)
  - Wallet Secret Keys / Private Signatures
  - KEK / DEK Encryption Keys
- **Authentication and Authorization Decisions**:
  - Wallet Signature verification (Ed25519) for on-chain actions
  - JWT tokens for API session authentication
  - RBAC (Borrower, Agent, Admin) enforced on Express endpoints
  - 2-of-3 agent float transfer approval rule
  - 3-of-5 multisig governance for smart contract upgrades and override execution

---

## 2. STRIDE Threat Analysis

| Threat Category | Applicable? | Attack Scenario | Mitigation Strategy | Verification & Tests |
| :--- | :--- | :--- | :--- | :--- |
| **Spoofing** | **Yes** | Attacker impersonates a liquidity agent to request or approve float transfers (`agentFloatService`). | Cryptographic wallet signature verification on transfer initiation; 2-of-3 multisig verification (`initiator`, `recipient`, `admin`); JWT claims validated against RBAC rules. | `agentFloatTransfer.test.ts` & `agentFloatService.test.ts` (unauthorized approver rejected with HTTP 403). |
| **Tampering** | **Yes** | Attacker tampers with PII fields in database or float transfer request parameters in transit. | PII fields protected with AES-256-GCM authenticated encryption (detects ciphertext/nonce modification); HTTPS TLS 1.3 in transit; smart contract state hashes signed on-chain. | `piiCrypto.test.ts` (MAC authentication tag failure triggers decryption throw); database schema constraints. |
| **Repudiation** | **Yes** | Malicious agent denies initiating or approving a float transfer or loan disbursement. | Immutable append-only `audit_logs` table recording actor, action, timestamp, target, and payload hash; Soroban event indexer checkpoints on-chain transactions. | `agentFloatService.test.ts` (verifies audit log entry inserted for every initiation, approval, rejection, and execution). |
| **Information Disclosure** | **Yes** | Attacker gains read access to PostgreSQL database or application log files and extracts user PII. | Field-level envelope encryption (`piiCrypto`) ensures raw PII is never written in plaintext to DB; logger redacts PII keys (`LOG_REDACTION=strict`). | `piiCrypto.test.ts` (serialization verification `pii:v...`); `winston` log redaction test suite. |
| **Denial of Service** | **Yes** | Malicious actor floods API with float transfer requests or OTP calls, exhausting database connection pool. | Express rate limiting (`express-rate-limit`) backed by Redis token bucket; agent pair daily/weekly float transfer caps; circuit breaker pause capabilities. | `rateLimitService.test.ts`; `agentFloatService.test.ts` (daily and weekly limit breach enforcement returning HTTP 400). |
| **Elevation of Privilege** | **Yes** | Normal borrower user calls admin-only endpoints to alter agent float pair limits or upgrade contract Wasm. | Strict RBAC middleware checking user roles (`admin` role required); Soroban contracts enforce `3-of-5` `MultisigGovernance` threshold for admin functions. | `agentRbac.test.ts`; smart contract integration tests (`multisig_governance.rs`). |

---

## 3. Abuse Cases and Residual Risk

### 3.1 Abuse Cases Considered
- **Collusion between 2 Agents**: Two rogue agents attempting to drain float by approving each other's fake float transfers.
  - *Mitigation*: Daily and weekly pair caps enforced by `AgentFloatService` (`checkLimits`); total agent float bounded by agent collateral invariant.
- **Compromised Backend Application Server**: An attacker gaining root access on an API node attempting to decrypt all historical PII.
  - *Mitigation*: KEK is stored in cloud KMS / HSM with restrictive IAM policy. Even with local server memory compromise, historical DEK rotation limits breach blast radius.

### 3.2 Rate Limits and Failure Behavior
- Public API endpoints return HTTP `429 Too Many Requests` when limits are breached.
- Database connection pool exhaustion triggers fail-closed behavior (requests fail securely without exposing internal stack traces).

### 3.3 Logging, Alerting, and Audit Trail
- All financial state mutations, PII decryption requests, and administrative setting changes log structured events to `audit_logs`.
- Real-time alerts fire on PII key rotation failure, solvency invariant breach, or unhandled 5xx spikes.

### 3.4 Residual Risks Accepted
- **Soroban Network Congestion**: External Stellar network delay may cause temporary latency spikes in contract execution. *Accepted by Product Owner; mitigated by transaction status polling and user status messaging.*

---

## 4. Security Review & Sign-Off

- [x] Threat model covers every changed trust boundary.
- [x] Security-sensitive assumptions have tests (`piiCrypto.test.ts`, `agentFloatService.test.ts`, `agentRbac.test.ts`).
- [x] Security champion reviewed and validated this model.
- [x] Follow-up items tracked in project milestone issues.
