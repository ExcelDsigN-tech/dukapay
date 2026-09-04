# DukaPay Contracts — Architecture & Invariants

This document describes the Soroban smart contracts deployed on Stellar,
their responsibilities, and the invariants that must hold at all times.

## Core Contracts

| Contract | Purpose |
|----------|---------|
| `agent_vault` | Agent float/collateral vault with solvency invariant |
| `agent_registry` | Agent onboarding, KYC, bond management |
| `loan_manager` | Loan lifecycle management |
| `lending_pool` | Pool deposits, withdrawals, yield |
| `remittance_nft` | Remittance NFT issuance & credit scores |
| `multisig_governance` | Multi-signature governance |
| `money` | Shared monetary policy/constants |

---

## Agent Vault — Solvency Invariant

The protocol's **core invariant** is enforced on-chain in the `agent_vault`
contract:

```
float <= collateral * haircut_bps / 10_000
```

This means an agent can never issue float (stablecoin credit) in excess of
what their posted collateral can back, adjusted for the haircut ratio.

### Invariant Enforcement

The invariant is checked at **every state-mutating operation**:

| Function | Invariant Check |
|----------|----------------|
| `deposit_collateral` | Always holds (float unchanged, collateral increases) |
| `withdraw_collateral` | Verified after reducing collateral |
| `mint_float` | Verified before increasing float |
| `burn_float` | Always holds (float decreases, collateral unchanged) |
| `transfer_float` | Verified on recipient's vault |
| `settle_net` | Verified for each entry in the batch |
| `set_haircut` | Verified with new haircut ratio |

### View Functions for Off-Chain Verification

- **`check_invariant(agent)`** — Returns `(holds, float, max_allowed)` for a
  single agent. Emits an `InvariantChecked` event for indexer consumption.
- **`check_invariants(agents)`** — Batch check across multiple agents. Returns
  a Vec of `(agent, holds, float, max_allowed)` tuples.

### Events

All invariant checks emit an `InvariantChecked` event:

```
InvariantChecked { agent, holds, float, max_allowed }
```

The off-chain indexer can subscribe to these events to build a real-time
solvency dashboard and trigger alerts when any agent's invariant is violated.

### Haircut Ratios

- Stored on-chain per-agent in the vault struct (`haircut_bps`).
- Global maximum stored in `Params.max_haircut_bps`.
- Updatable by the operator via `set_haircut()` — must not break solvency
  for the agent's outstanding float.
- Default haircut on first deposit equals the global maximum.

### Governance Updates

Haircut parameters are updateable through the operator (DukaPay settlement
backend). Future governance integration via `multisig_governance` contract
is planned for parameter changes.

---

## Contract Upgrade Governance (Issue #452)

Every WASM upgrade of a DukaPay contract flows through the
`multisig_governance` contract's **upgrade timelock** (`src/upgrade_timelock.rs`):

| Step | Function | Who |
|------|----------|-----|
| Configure quorum (once) | `configure_upgrade_signers(signers, threshold)` | admin |
| Queue an upgrade | `queue_upgrade(proposer, target, new_wasm_hash)` | any signer / admin |
| Approve | `approve_upgrade(signer)` | configured signer (idempotent) |
| Execute after timelock | `execute_upgrade(caller)` | anyone |
| Abort | `cancel_upgrade(caller)` | any signer / admin |
| Circuit breaker | `emergency_pause(caller)` / `emergency_unpause()` | pause: any signer • unpause: admin only |

Enforced **on-chain**:

- **48-hour timelock** (`UPGRADE_TIMELOCK_SECONDS = 172_800`) between queue and
  execute — not overridable by the proposer.
- **3-of-5 multi-sig** — DukaPay quorum is `[admin, security, ops, legal, community]`
  with `threshold = 3`.
- **14-day TTL** — a queued-but-unexecuted upgrade expires and can be replaced.
- **Single in-flight upgrade** — a new one cannot be queued while one is pending.
- **Emergency pause** halts *all* `execute_upgrade` calls immediately; any single
  signer can trip it, only the admin can lift it.

`execute_upgrade` performs a cross-contract call to `target.upgrade(new_wasm_hash)`.
For this to work, **every managed contract must set its `admin` to the
`multisig_governance` contract address** (via each contract's existing
`set_admin` / admin-transfer flow). Until migrated, a contract's upgrades are
still gated only by its raw admin key.

---

## Fuzz Testing

The `agent_vault` contract includes property-based fuzz tests (via `proptest`)
that verify:

1. **`max_float_of` is bounded**: `max_float_of(c, h) <= c` for all inputs.
2. **`max_float_of` is monotonic**: Increasing collateral never decreases the
   float cap.
3. **Invariant holds under adversarial sequences**: Random sequences of
   deposits, withdrawals, mints, burns, and transfers never break solvency
   when operations are properly authorized.

Run fuzz tests:

```bash
cd contracts
cargo test --test-threads=1
```

---

## Security Model

For the authentication and authorization model (roles, scopes, JWT flow,
API-key namespaces) see [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).

For vulnerability reporting, see [SECURITY.md](SECURITY.md).
