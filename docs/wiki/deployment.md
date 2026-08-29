# Deployment Runbooks

Operational procedures for deploying and upgrading DukaPay to **testnet** and
**mainnet**. These runbooks assume a prepared environment per
[`docs/ENVIRONMENT.md`](../ENVIRONMENT.md) and a successful `cargo build` of the
contracts (see [Contributor Onboarding](onboarding.md)).

## Pre-flight checklist

- [ ] `cargo fmt --check` and `cargo clippy` clean on `contracts/`
- [ ] `cargo test` green for all contracts
- [ ] Frontend `npm run lint && npm run test` green
- [ ] Backend `npm run lint && npm run test` green
- [ ] Secrets sourced from the secret manager / env, **never** committed
- [ ] Deployer keys live in the HSM / MPC (see
      [`docs/security/key-management.md`](../security/key-management.md))
- [ ] CircuitBreaker signer set and `MultisigGovernance` configured
- [ ] Rollback / previous Wasm hash recorded

## Testnet deployment

```bash
# 1. Build optimized Wasm for every contract
cd contracts
cargo build --target wasm32-unknown-unknown --release \
  -p lending_pool -p agent_vault -p loan_manager \
  -p remittance_nft -p agent_registry -p multisig_governance -p circuit_breaker

# 2. Deploy + initialize via the deploy script
cd ../scripts
npx tsx deploy.ts --network testnet --deployer $DEPLOYER_WALLET
```

Verify each contract ID is written to `docs/deployed-contracts.md` and the
matching `.env` is updated (testnet section).

## Mainnet deployment

> Mainnet changes require a 3-of-5 governance sign-off and a timelocked
> `MultisigGovernance` proposal.

```bash
# 1. Stage the upgrade behind a governance proposal
npx tsx deploy.ts --network mainnet --stage --wasm ./artifacts/lending_pool.wasm

# 2. After the timelock elapses and the threshold is met, finalize
npx tsx deploy.ts --network mainnet --finalize --proposal <id>
```

## Wiring the CircuitBreaker

After deploying `circuit_breaker`:

1. `initialize(admin, signers, threshold=3, override_timelock=86400)`.
2. For each guarded contract, call `set_circuit_breaker(<breaker_id>)`:
   - `LendingPool::set_circuit_breaker`
   - `AgentVault::set_circuit_breaker`
   - `LoanManager::set_circuit_breaker`
3. Smoke-test: trip `pause_all` with a signer, confirm guarded calls revert
   with `CircuitBreakerTripped`, then `propose_override` / `approve_override`
   (×3) / `execute_override` to resume.

## Rollback

1. Re-deploy the previously recorded Wasm hash via the governance upgrade path.
2. Confirm the CircuitBreaker is not blocking the upgrade (a pause does not
   block `upgrade`/admin functions by design).

## Post-deploy verification

- [ ] All contract IDs recorded in `docs/deployed-contracts.md`
- [ ] `get_pause_state()` on the breaker returns no active pauses
- [ ] A canary `deposit` / `request_loan` succeeds on testnet before mainnet
- [ ] Monitoring dashboards receiving `Paused*` / `Lifted*` / `Override*`
      events
