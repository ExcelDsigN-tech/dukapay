# DukaPay Security Architecture & Threat Model

This document presents the comprehensive security architecture, defense-in-depth security controls, trust boundaries, key management hierarchy, and incident response procedures for the DukaPay platform.

---

## 1. Executive Summary & Security Principles

DukaPay provides fair lending and agent-based cross-border remittance facilities for migrant workers. Because DukaPay processes both financial transactions on the Stellar/Soroban blockchain and sensitive Personally Identifiable Information (PII) off-chain, security is engineered around four core principles:

1. **Defense in Depth**: Security controls operate at every layer (Network, Transport, Application, Storage, Smart Contract).
2. **Least Privilege & Role-Based Control**: Every component, API key, and user session carries only the minimal required scope.
3. **Cryptographic Protection of PII**: Zero raw PII in persistent storage; field-level envelope encryption with automated key rotation.
4. **Non-Bypassable Circuit Breakers**: Smart contract state-machine invariants enforced on-chain with emergency pause capability.

---

## 2. Authentication & Authorization Model

```
       [ Client App / SDK ]
                 │
  (1) JWT / Ed25519 Signature / API Key
                 ▼
     [ API Gateway / Express ]
                 │
   (2) Authentication Middleware
                 │
   (3) RBAC Authorization Check
                 ▼
    [ Application Service Layer ]
```

### 2.1 Identity & Authentication Mechanisms
- **JWT (JSON Web Tokens)**: Issued upon successful Stellar/Soroban wallet signature verification or phone OTP verification. Signed using SHA-256 HMAC / RSA signatures with strict TTL validation and revocation lists.
- **Stellar Wallet Signatures**: High-value transactions (loan requests, collateral deposits, float transfers) require cryptographic Ed25519 signature verification on-chain.
- **Internal & External API Keys**: Service-to-service communication relies on scoped `INTERNAL_API_KEY` headers with IP whitelist enforcement.

### 2.2 Role-Based Access Control (RBAC)
- **Borrower**: Access restricted strictly to own loan applications, active balances, and masked profile.
- **Agent**: Authorized to manage float requests, view assigned borrower repayments, and initiate float transfers (subject to 2-of-3 multisig).
- **Admin**: Multi-factor authenticated roles with administrative capabilities (pair limit management, manual dispute resolution, system configuration).

---

## 3. Cryptographic Encryption Layers

DukaPay enforces strict data encryption standards across all data lifecycle states:

```
  +-----------------------------------------------------------------------+
  |                          Data-in-Transit                              |
  |             HTTPS / TLS 1.3 - Strict Transport Security (HSTS)         |
  +-----------------------------------------------------------------------+
                                      │
                                      ▼
  +-----------------------------------------------------------------------+
  |                          Data-in-Application                          |
  |         PII Envelope Encryption (AES-256-GCM + Per-Field DEK)        |
  +-----------------------------------------------------------------------+
                                      │
                                      ▼
  +-----------------------------------------------------------------------+
  |                           Data-at-Rest                                |
  |              PostgreSQL Volume Encryption (AES-256)                   |
  +-----------------------------------------------------------------------+
```

### 3.1 PII Envelope Encryption (`piiCrypto.ts`)
- **Key Encryption Key (KEK)**: Stored securely in cloud KMS / HSM. Never persisted in application source code or DB.
- **Data Encryption Key (DEK)**: Unique ephemeral key generated per encrypted record/field using AES-256-GCM.
- **Envelope Payload Format**: `pii:v{version}:{kekId}:{base64_dek}:{base64_nonce}:{base64_ciphertext}`.
- **Key Rotation**: Automated 90-day DEK expiration and re-encryption pipeline (`migratePiiData`) without downtime.

---

## 4. Smart Contract Circuit Breaker & Governance

### 4.1 Circuit Breaker Architecture
All core Soroban contracts (`LendingPool`, `AgentVault`, `LoanManager`) inherit the `CircuitBreaker` interface:
- **Global Emergency Pause**: `pause_all()` halts all financial state mutations across all guarded contracts.
- **Granular Pause**: Allows pausing specific actions (e.g., `pause_borrowing`, `pause_float_transfers`).
- **State Guarantee**: Pause state does NOT freeze administrative upgrade proposals or governance operations, ensuring recovery paths remain open.

### 4.2 Multisig Governance Workflow
- **Threshold**: 3-of-5 multisig governance signers required for executing contract Wasm upgrades or lifting circuit breaker pauses.
- **Timelock**: Standard governance proposals enforce a 24-hour timelock (`override_timelock`) before final execution.

---

## 5. Rate Limiting & Denial of Service Protection

- **Express Rate Limiting**: Dynamic IP and token-bucket rate limiting applied per route class:
  - Public Auth / OTP Endpoints: 5 requests / minute.
  - Standard API Endpoints: 100 requests / minute per user/IP.
  - Internal Webhook Ingestion: Scoped by HMAC signature verification and IP whitelist.
  - Sensitive read endpoints (each with its own counter, keyed by authenticated wallet, or by IP when unauthenticated; over the limit returns `429` with a `Retry-After` header):
    - `GET /api/admin/audit-logs`: 30 requests / minute per admin.
    - `GET /api/admin/disputes`, `GET /api/admin/disputes/:disputeId`: 60 / minute per admin (shared counter).
    - `GET /api/admin/governance/pending`: 60 / minute per admin.
    - `GET /api/pool/analytics` and `GET /api/score/leaderboard` (public): 60 / minute per IP.
    - `GET /api/score/:userId`, `/:userId/breakdown`, `/:walletAddress/history`, `/:walletAddress/nft`: 60 / minute per wallet (shared counter).
- **Redis Rate-Limiter Store**: Distributed atomic counters prevent burst traffic and distributed brute-force attempts across clusters.

---

## 6. System Components & Security Boundaries

```
[ External / Internet ]
        │  (Untrusted)
        ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Boundary 1: Web Application Firewall (WAF) & Rate Limiter             │
└────────────────────────────────────────────────────────────────────────┘
        │  (Filtered HTTPS)
        ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Boundary 2: Backend API Services (Express Node.js Cluster)            │
│  - JWT Verification, PII Envelope Encrypt/Decrypt, RBAC Enforcement   │
└────────────────────────────────────────────────────────────────────────┘
        │                          │                          │
 (Internal TLS)             (Internal TLS)             (Encrypted RPC)
        ▼                          ▼                          ▼
┌──────────────┐          ┌─────────────────┐        ┌───────────────────┐
│ Boundary 3:  │          │ Boundary 4:     │        │ Boundary 5:       │
│ PostgreSQL   │          │ Redis Cache     │        │ Stellar Horizon / │
│ (Encrypted   │          │ & PubSub        │        │ Soroban Contracts │
│ Storage)     │          │ (Session/Rates) │        │ (On-Chain State)  │
└──────────────┘          └─────────────────┘        └───────────────────┘
```

---

## 7. Key Management Hierarchy

| Key Tier | Description | Storage Location | Rotation Period | Access Level |
| :--- | :--- | :--- | :--- | :--- |
| **Root KEK (Key 0)** | Master key wrapping per-record DEKs | Cloud KMS / HSM | 365 Days | Application KMS Role |
| **Data Encryption Keys (DEKs)** | Ephemeral keys encrypting individual PII fields | Wrapped in DB payload | 90 Days (Automated) | `piiCrypto` Service |
| **Deployer Wallets** | Stellar secret keys for smart contract deployment | Cloud HSM / MPC Vault | Per Deployment | CI/CD Pipeline Agent |
| **Multisig Governance Keys** | 5 independent keys controlling governance & breaker | Hardware Wallets / MPC | Static (Key Ceremony) | 5 Named Executive Signers |

---

## 8. Incident Response Runbook

### 8.1 Incident Severity Matrix

| Severity | Description | Immediate Action | Escalation Target |
| :--- | :--- | :--- | :--- |
| **SEV-0 (Critical)** | Solvency breach, active exploit, or PII key leak | Trip `CircuitBreaker::pause_all()`, rotate KEK | Security Lead & Emergency Response Lead |
| **SEV-1 (High)** | API outage, high error rate, or indexer failure | Trigger `rollback-blue-green.sh`, failover DB | DevOps Lead & On-Call SRE |
| **SEV-2 (Medium)** | Non-critical service degradation or rate limit abuse | Adjust Redis rate limits, block offending IPs | On-Call SRE |

### 8.2 Emergency Pause Execution Steps
1. **Detect**: Alert triggered by solvency monitor, anomaly detector, or manual report.
2. **Execute Pause**: Emergency Response Lead issues signed pause call via `circuit_breaker` CLI tool.
3. **Isolate**: Freeze affected backend API endpoints and disable outbound float worker queues.
4. **Investigate**: Collect immutable audit logs from `audit_logs` table and Soroban indexer checkpoints.
5. **Remediate**: Deploy code/contract patch, execute 3-of-5 governance approval.
6. **Resume & Post-Mortem**: Lift breaker pause and publish root-cause analysis (RCA) within 48 hours.
