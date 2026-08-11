# DukaPay

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Frontend: Next.js](https://img.shields.io/badge/Frontend-Next.js-black?logo=next.js)](https://nextjs.org/)
[![Backend: Express](https://img.shields.io/badge/Backend-Express.js-white?logo=express)](https://expressjs.com/)
[![Smart Contracts: Soroban](https://img.shields.io/badge/Smart_Contracts-Soroban-orange)](https://soroban.stellar.org/)
[![Stellar](https://img.shields.io/badge/Stellar-Soroban-purple)](https://stellar.org)

**DukaPay** (duka = shop in Swahili) is an on-chain agent-banking float & settlement protocol that turns local shops into stablecoin cash-in / cash-out points for the unbanked. It is the open, auditable, production-grade reference implementation of agent banking on Stellar — the liquidity/settlement spine beneath consumer payments.

## ✨ Why it exists

400M+ unbanked Africans transact in cash. Mobile money reaches them through agents — local shop owners who hold float (cash + e-money) and convert one into the other. That agent layer is the real last-mile financial infrastructure. But float is siloed, trust is blind (no ledger), solvency is unenforced, and settlement lags in private off-chain books. A stablecoin is useless in a cash economy without a cash-in/cash-out network. DukaPay is that network layer.

## ✨ Key Features

- **Agent onboarding**: shop owners register with KYC/AML attestation and lock a USDC bond → an active agent with an on-chain record.
- **Cash-in / Cash-out**: customers convert cash to stablecoin (or mobile-money credit) and back, through a transparent on-chain float ledger.
- **Collateralized float**: an agent's e-money issuance can never exceed `collateral × haircut` — solvency is enforced, not promised.
- **Agent-to-agent float transfer**: atomic rebalancing between agents, no cash moves.
- **Net settlement**: the operator batches transactions, nets positions, and finalizes atomically on-chain.
- **Disputes & audits**: disputes hold a position on-chain with ground truth; regulators get read-only proof that Σ float ≤ Σ collateral.

## 🏗 Project Structure

Monorepo:

- **`contracts/`**: Soroban (Rust) smart contracts — `agent-registry`, `agent-vault`, `settlement-netter` (+ integration & proptest harness).
- **`backend/`**: Node.js/Express API — onboarding, KYC adapter, transaction API, settlement service.
- **`frontend/`**: Next.js web application — agent dashboard, admin console, find-an-agent map.
- **`sdk/`**: TypeScript SDK — register agents, cash-in/out, settle.
- **`indexer/`**: Rust → PostgreSQL event index and audit queries.
- **`infra/`**, **`scripts/`**, **`docs/`**: docker-compose, bootstrap scripts, architecture & ADRs.

*For the system design, see [ARCHITECTURE.md](ARCHITECTURE.md).*

### API Reference

The backend exposes interactive Swagger UI at [http://localhost:3001/docs](http://localhost:3001/docs) (OpenAPI JSON: `/docs.json`), gated to non-production environments.

## 🛠 Tech Stack

- **Blockchain**: [Stellar](https://stellar.org) (Soroban Smart Contracts, SDK v22)
- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS
- **Backend**: Node.js, Express, TypeScript, Jest
- **Contracts**: Rust 1.85, soroban-sdk 22, proptest
- **Wallet Integration**: [Stellar Wallet Kit](https://github.com/stellar/stellar-wallet-kit) (Freighter)

## 🏁 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/)
- [Docker & Docker Compose](https://www.docker.com/) (recommended)
- [Rust & Cargo](https://rustup.rs/) (contract development)
- [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup) (contract deployment)

### Quick Start with Docker (Recommended)

```bash
git clone https://github.com/ExcelDsigN-tech/remitlend.git dukapay
cd dukapay
cp backend/.env.example backend/.env
docker compose up --build
```

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:3001](http://localhost:3001)
- API Docs: [http://localhost:3001/docs](http://localhost:3001/docs)

### Manual Setup

#### Backend

```bash
cd backend
npm install
cp .env.example .env
npm run migrate:up
npm run dev
```

#### Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:3000
```

#### Smart Contracts

```bash
rustup target add wasm32-unknown-unknown
cd contracts
cargo build --target wasm32-unknown-unknown --release
cargo test
```

## 🔒 Security

See [SECURITY.md](SECURITY.md). Report vulnerabilities per the security policy.

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, …).

## 📄 License

ISC. See `LICENSE`.
