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

## Mainnet

No contracts deployed yet.

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
