# Deployed Contract Registry

This document is the human-readable rendering of the **single source of truth** for deployed
Soroban contract IDs across all networks: [`scripts/contract-registry.json`](../scripts/contract-registry.json).
Update **that file** whenever a contract is (re-)deployed — this page's tables are kept in sync
with it, and [`scripts/verify-contracts.ts`](../scripts/verify-contracts.ts) checks that the
registry, the on-chain state, and `backend/.env` agree.

> **Secrets note**: contract IDs, deployer addresses and deploy tx hashes are public — safe to
> commit. **Never** commit secret/admin keys or signing secrets here or in the registry JSON.

---

## How to record a deployment

After running the deployer:

```bash
cd scripts && npm install
SECRET_KEY=S... npm run deploy -- testnet
```

1. Copy each printed contract ID (and its deploy tx hash) into the matching entry in
   `scripts/contract-registry.json`.
2. Fill in `deployDate` (YYYY-MM-DD), `deployer`, `deployTxHash`, `abiVersion`,
   `upgradeAuthority` and `timelock`.
3. Set the same IDs in `backend/.env` (and in CI secrets for staging/production).
4. Re-run the verifier to confirm everything agrees:

```bash
cd scripts && npm run verify:contracts
```

5. Commit the updated registry, docs table and `.env.example` in the same PR as any deployment.

---

## Testnet (`Test SDF Network ; September 2015`)

RPC: `https://soroban-testnet.stellar.org`  
Explorer: `https://stellar.expert/explorer/testnet`

| Contract | Address (`C…`) | Deploy Date | Deployer | Deploy Tx Hash | ABI Version | Upgrade Authority | Timelock |
|---|---|---|---|---|---|---|---|
| `loan_manager` | _not yet recorded_ | — | — | — | — | — | — |
| `lending_pool` | _not yet recorded_ | — | — | — | — | — | — |
| `remittance_nft` | _not yet recorded_ | — | — | — | — | — | — |
| `multisig_governance` | _not yet recorded_ | — | — | — | — | — | — |
| `token` (USDC-like pool token) | _not yet recorded_ | — | — | — | — | — | — |
| `agent_registry` | _not yet recorded_ | — | — | — | — | — | — |
| `agent_vault` | _not yet recorded_ | — | — | — | — | — | — |

### Environment variables that consume these IDs

#### Backend (`backend/.env`)

| Contract | Env var |
|---|---|
| `loan_manager` | `LOAN_MANAGER_CONTRACT_ID` |
| `lending_pool` | `LENDING_POOL_CONTRACT_ID` |
| `remittance_nft` | `REMITTANCE_NFT_CONTRACT_ID` |
| `multisig_governance` | `MULTISIG_GOVERNANCE_CONTRACT_ID` |
| `token` | `POOL_TOKEN_ADDRESS` |
| `agent_registry` | `AGENT_REGISTRY_CONTRACT_ID` |
| `agent_vault` | `AGENT_VAULT_CONTRACT_ID` |

#### Frontend (`frontend/.env`)

The frontend does not currently read contract IDs directly from env. It calls the backend API,
which resolves contract addresses at runtime using the backend vars above.

---

## Futurenet

No contracts deployed yet.

---

## Mainnet (`Public Global Stellar Network ; September 2015`)

> **Status (mainnet launch — blocked until #561/#562 + external audit land):** registry is **scaffolded but no contracts have ever touched Stellar mainnet**. The deploy config (`scripts/deploy-config.json` `mainnet` block) and registry (`scripts/contract-registry.json` `networks.mainnet`) are now structurally prepared so the deploy and verification tooling works — `scripts/deploy.ts -- mainnet` can be run once the correctness gaps and audit are cleared. This is real-money deployment, not a testnet redeploy.

RPC: `https://soroban-rpc.stellar.org`  
Explorer: `https://stellar.expert/explorer/public`  
Deploy config: `scripts/deploy-config.json` (`mainnet`: `networkPassphrase`, `rpcUrl`, `admin` placeholder, `token` placeholder, `contracts.*.wasm` for all 9 workspace contracts)  
Registry: `scripts/contract-registry.json` (`networks.mainnet` — 9 entries scaffolded with `not yet recorded` placeholders, matching `testnet` shape plus `audit_anchor` and `oracle`)

| Contract | Address (`C…`) | Deploy Date | Deployer | Deploy Tx Hash | ABI Version | Upgrade Authority | Timelock |
|---|---|---|---|---|---|---|---|
| `loan_manager` | _not yet recorded_ | — | — | — | — | — | — |
| `lending_pool` | _not yet recorded_ | — | — | — | — | — | — |
| `remittance_nft` | _not yet recorded_ | — | — | — | — | — | — |
| `multisig_governance` | _not yet recorded_ | — | — | — | — | — | — |
| `token` (USDC-like pool token) | _not yet recorded_ | — | — | — | — | — | — |
| `agent_registry` | _not yet recorded_ | — | — | — | — | — | — |
| `agent_vault` | _not yet recorded_ | — | — | — | — | — | — |
| `audit_anchor` | _not yet recorded_ | — | — | — | — | — | — |
| `oracle` | _not yet recorded_ | — | — | — | — | — | — |

### How mainnet deploy will be executed (when unblocked)

```bash
# 1. Build wasms for all 9 contracts
cargo build --target wasm32-unknown-unknown --release --manifest-path contracts/Cargo.toml

# 2. Deploy to mainnet (admin key via secrets manager — never commit the S... secret)
SECRET_KEY=S... npm run deploy -- mainnet   # runs scripts/deploy.ts -- mainnet for all contracts

# 3. Record each printed contract ID, deploy tx hash, deploy date, deployer, ABI version,
#    upgrade authority and timelock in scripts/contract-registry.json (mainnet block)

# 4. CRITICAL: migrate every contract's admin to multisig_governance (per CONTRACTS.md)
#    Contracts not migrated stay gated by a raw admin key — not acceptable for mainnet.
#    Verify via: stellar contract info --id <C...> --network mainnet

# 5. Set the resulting contract IDs in production env / CI secrets
#    (backend/.env.production, GitHub production environment vars/secrets, etc.)

# 6. Verify registry/on-chain/env agreement
npm run verify:contracts -- --network mainnet --format text

# 7. Commit registry + docs + .env.production.example diff in same PR
```

Once steps 3–5 are done, replace the table above with real `C...` addresses (still safe to commit) and `verify-contracts.ts` will report `OK` instead of `SKIPPED`.

### Environment variables that consume these IDs (mainnet)

Same as testnet (see table above), but sourced from **production** secrets:

| Contract | Env var | Production source |
|---|---|---|
| `loan_manager` | `LOAN_MANAGER_CONTRACT_ID` | `production` env `LOAN_MANAGER_CONTRACT_ID` secret + `backend/.env.production` |
| `lending_pool` | `LENDING_POOL_CONTRACT_ID` | `production` env |
| `remittance_nft` | `REMITTANCE_NFT_CONTRACT_ID` | `production` env |
| `multisig_governance` | `MULTISIG_GOVERNANCE_CONTRACT_ID` | `production` env |
| `token` | `POOL_TOKEN_ADDRESS` | `production` env `POOL_TOKEN_ADDRESS` |
| `agent_registry` | `AGENT_REGISTRY_CONTRACT_ID` | `production` env |
| `agent_vault` | `AGENT_VAULT_CONTRACT_ID` | `production` env |
| `audit_anchor` | `AUDIT_ANCHOR_CONTRACT_ID` | `production` env (also `AUDIT_ANCHOR_ENABLED=true` per #565) |
| `oracle` | `ORACLE_CONTRACT_ID` | `production` env |

Frontend remains API-driven (no direct contract env reads).

### Post-deploy verification

- `scripts/verify-contracts.ts --network mainnet` checks address format, env consistency, on-chain existence (best-effort RPC probe), and metadata completeness.
- Before any mainnet contract is populated, verification reports `SKIPPED` (placeholders) — not a failure — so CI stays green until real deployment.
- After deployment, the same check must pass clean (`OK`) for **every** mainnet entry, including `audit_anchor`/`oracle`, and every contract's admin must be verified as `multisig_governance` (see `CONTRACTS.md` upgrade governance).

---

## Verification

`scripts/verify-contracts.ts` checks, per recorded contract:

1. **Address format** — every recorded address is a valid Stellar contract ID (`C…`).
2. **Env consistency** — the recorded address matches the value set for its backend env var.
3. **On-chain existence** — the network RPC is reachable and serving (best-effort; skipped when
   the RPC is unavailable from the runner).
4. **Metadata completeness** — ABI version, upgrade authority, timelock, deployer, deploy tx
   hash and deploy date are all recorded.

Unrecorded placeholders (`not yet recorded`) and missing environment inputs are reported as
`SKIPPED`, never as failures, so the checks stay green until real deployments are recorded.
Run it locally with:

```bash
cd scripts && npm run verify:contracts -- --format markdown
```
