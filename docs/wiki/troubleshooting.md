# Troubleshooting Guide

Common failure modes and how to diagnose them.

## Contracts

### `ContractPaused` / `CircuitBreakerTripped` on a guarded call

**Symptom:** `deposit`, `withdraw`, `request_loan`, `approve_loan`, `repay`,
`mint_float`, `settle_net`, etc. revert.

**Causes:**
- The contract's own `Paused` flag is set (admin `pause`/`unpause`).
- The `CircuitBreaker` has tripped a global, contract, or function pause.

**Diagnosis:**
```bash
# Is the local pause flag set?
LendingPoolClient::is_paused()

# Is the circuit breaker blocking this function?
LendingPoolClient::is_circuit_blocked(Symbol::new(env, "deposit"))

# Full breaker state (off-chain dashboard equivalent)
CircuitBreakerClient::get_pause_state()
```

**Resolution:**
- Local pause: admin calls `unpause`.
- Circuit breaker: a 3-of-5 governance override is required —
  `propose_override` → `approve_override` (×threshold) → `execute_override`
  (after the override timelock). Note every pause **auto-expires after 72h**.

### `SolvencyViolated` in `AgentVault`

The agent's float would exceed `collateral * haircut_bps / 10_000`. Mint/burn
or collateral move rejected. Check `max_float(agent)` and current `get_vault`.

### `MinSharesNotMet` / `MinAssetsNotMet`

Slippage bounds (`min_shares_out`, `min_assets_out`) were not met. Re-quote
with `preview_deposit` / `preview_redeem` before submitting.

### Loan `PoolPaused` / `NftPaused`

`LoanManager` cascades pauses from the `LendingPool` and `RemittanceNFT`. Clear
those first.

## Backend

### Indexer lag

- Check the indexer cursor in the ops dashboard.
- Re-run the [indexer recovery runbook](../runbooks/indexer-recovery.md).
- Verify the RPC/horizon endpoint health.

### Rate oracle returning out-of-bounds rate

`LoanManager` clamps the oracle rate to `[MinRateBps, MaxRateBps]` and falls
back to the configured default. If loans use the default unexpectedly, inspect
the oracle signer key (see key management).

## Emergency contacts

- Pause authority (security council signers) for the CircuitBreaker.
- Governance admins for `MultisigGovernance` upgrades.
- On-call in the Telegram ops channel.

## Log hygiene

DukaPay intentionally avoids logging PII or secret material. If you see a stack
trace surfacing addresses or amounts in error messages, that is expected
(non-PII); never add raw signing keys or mnemonic material to logs.
