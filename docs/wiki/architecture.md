# DukaPay Architecture

This page is the entry point for the **Contributor Wiki**. It explains how the
system fits together, the key data flows, how to deploy it, how to troubleshoot
common problems, and how to onboard as a new contributor.

- [System Architecture](#system-architecture)
- [Data Flows](#data-flows)
- [Deployment Runbooks](deployment.md)
- [Troubleshooting](troubleshooting.md)
- [Contributor Onboarding](onboarding.md)

---

## System Architecture

DukaPay is a stablecoin lending and remittance protocol for migrant workers. It
is composed of a TypeScript/Next.js **frontend**, a Node/Express **backend**
(oracle, settlement, indexing), and a set of **Soroban (Rust) smart
contracts** that hold the on-chain state and enforce the core financial
invariants.

```mermaid
flowchart TB
    subgraph OffChain["Off-chain"]
        FE["Frontend (Next.js)"]
        BE["Backend (Node/Express)"]
        ORA["Rate Oracle"]
        IDX["Event Indexer"]
        OP["Ops / Monitoring"]
    end

    subgraph OnChain["On-chain (Stellar / Soroban)"]
        LP["LendingPool"]
        AV["AgentVault"]
        LM["LoanManager"]
        RN["RemittanceNFT"]
        AR["AgentRegistry"]
        MG["MultisigGovernance"]
        CB["CircuitBreaker"]
    end

    FE -->|quote / submit tx| BE
    FE -->|read state| OnChain
    BE -->|settle float / rates| OnChain
    ORA -->|interest rate| LM
    IDX -->|ingest events| OP
    BE -->|index| IDX

    LP -->|outstanding balances| LM
    AV -->|agent float / collateral| BE
    LM -->|approve loan / repay| LP
    LM -->|score updates| RN
    MG -->|admin transfer| OnChain
    CB -->|pause checks| LP
    CB -->|pause checks| AV
    CB -->|pause checks| LM
```

### Contract responsibilities

| Contract | Responsibility |
| --- | --- |
| `LendingPool` | Holds lender liquidity, mints/burns LP shares, realizes yield. |
| `AgentVault` | Holds each agent's USDC collateral and float (stablecoin credit). |
| `LoanManager` | Originates, approves, repays, liquidates loans; consumes rate oracle. |
| `RemittanceNFT` | Reputation score (on-time repayment, defaults). |
| `AgentRegistry` | On/off-boarding of settlement agents. |
| `MultisigGovernance` | 3-of-5 admin transfer with timelock. |
| `CircuitBreaker` | Global / contract / function pause with 3-of-5 override + 72h auto-expiry. |

---

## Data Flows

### 1. Cash-in (agent funds float)

```mermaid
sequenceDiagram
    participant A as Agent
    participant FE as Frontend
    participant BE as Backend
    participant AV as AgentVault
    participant T as USDC

    A->>FE: Deposit collateral (USDC)
    FE->>AV: deposit_collateral(agent, amount)
    AV->>T: transfer(agent -> vault)
    AV-->>A: collateral recorded, haircut applied
    BE->>AV: mint_float(agent, amount)
    AV-->>BE: float within solvency bound (float <= collateral*haircut)
```

### 2. Loan origination & approval

```mermaid
sequenceDiagram
    participant B as Borrower
    participant LM as LoanManager
    participant RN as RemittanceNFT
    participant LP as LendingPool
    participant T as USDC

    B->>LM: request_loan(borrower, amount, term)
    LM->>RN: get_score(borrower)
    RN-->>LM: score (reputation gate)
    LM-->>B: loan_id (Pending)
    LM->>LP: approve_loan(loan_id)
    LP->>T: transfer(LP -> borrower, amount)
    LM-->>B: loan Approved, due date set
```

### 3. Repayment & settlement

```mermaid
sequenceDiagram
    participant B as Borrower
    participant LM as LoanManager
    participant LP as LendingPool
    participant RN as RemittanceNFT
    participant T as USDC

    B->>LM: repay(borrower, loan_id, amount)
    LM->>LP: transfer(borrower -> LP, amount)
    LM->>RN: update_score(borrower, repayment)
    LM-->>B: loan Repaid, collateral released
    BE->>AV: settle_net(entries)  // end-of-day agent float reconciliation
```

### 4. Emergency pause (CircuitBreaker)

Any governance signer may trip a global / contract / function pause. The
guarded contracts (`LendingPool`, `AgentVault`, `LoanManager`) reject
value-moving calls while a pause is active. Lifting a pause requires a 3-of-5
governance override that waits out a timelock, and every pause auto-expires
after 72 hours so funds are never permanently frozen.

---

See [Deployment Runbooks](deployment.md), [Troubleshooting](troubleshooting.md),
and [Contributor Onboarding](onboarding.md) for operational detail.
