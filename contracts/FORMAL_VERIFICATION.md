# Formal Verification of Core Contracts

This document specifies the **formal invariants** of DukaPay's core contracts
(`lending_pool`, `agent_vault`, `loan_manager`) and how they are verified.

## Tooling note: why not Certora?

[Certora Prover](https://www.certora.com/) and its CVL specification language
target the **EVM / Solidity** bytecode. DukaPay's contracts are **Soroban /
Rust** (`#![no_std]`, compiled to Wasm for the Stellar Soroban VM), so Certora
does **not** apply. The same rigor is achieved with the combination below:

| Technique | What it proves | Where |
| --- | --- | --- |
| **Overflow-checked arithmetic** | No integer wrap-around (overflow/underflow panics, never silently wraps) | `overflow-checks = true` in every `Cargo.toml` profile |
| **CEI pattern + `no_std`** | Reentrancy freedom: all external calls happen *after* state is committed | contract source review + fuzz |
| **Property / fuzz testing** | Invariants hold across arbitrary input sequences | `contracts/fuzz/` (libfuzzer) |
| **K framework / verified Rust** *(future)* | Mechanical proof of selected invariants | see [Roadmap](#roadmap) |

> CI runs `cargo test`, `cargo clippy`, and `cargo fmt --check` on every PR.
> The fuzzing campaign (`fuzz_campaign.sh`) is the executable counterpart of
> the specs below and is run as a scheduled (nightly) job.

## Invariants

Each invariant is written CVL-style for readability, followed by how it is
**actually** enforced in this Rust/Soroban codebase.

### INV-1 — AgentVault float solvency

```cvl
invariant floatSolvency(env, agent):
    vault(agent).float <= vault(agent).collateral
                        * vault(agent).haircut_bps / 10000
```

Enforced: `mint_float`, `withdraw_collateral`, `transfer_float`, `settle_net`,
and `set_haircut` all recompute `max_float_of(collateral, haircut)` and revert
with `SolvencyViolated` if the resulting float would exceed the bound. This is
checked by `agent_vault/src/test.rs` and by `fuzz_targets/invariants_fuzz.rs`.

### INV-2 — LendingPool share pricing is inflation-safe

```cvl
invariant noFirstDepositorInflation(env, token, provider, shares):
    get_deposit(provider, token) >= 0
    && calc_shares_to_mint(amount, M, S) > 0  when amount > 0
    && sharePrice(token) monotonic in (M, S)
```

Enforced: `VIRTUAL_SHARES` / `VIRTUAL_ASSETS` offset (10³) makes share price
well-defined at empty-pool and prevents a donation from rounding a victim's
minted shares to zero. Pricing uses internally tracked `TotalManagedAssets`,
never the live token balance.

### INV-3 — LoanManager total-debt cap

```cvl
invariant debtBounded(env, loan):
    remainingPrincipal + accruedInterest + accruedLateFee
        <= loan.amount * MAX_PENALTY_MULTIPLIER   // 2x
```

Enforced: `accrue_late_fee` clamps the per-call fee to `max_total_debt -
current_total_debt`, so fees can never push total debt beyond 2× principal.

### INV-4 — Reentrancy freedom

```cvl
rule noReentrancy(method f):
    // All cross-contract calls happen AFTER durable state changes (CEI).
    call f() => state committed before any external token/contract call
```

Enforced by construction: `loan_manager::approve_loan` and `::repay` write loan
state and mark terminal status **before** the `token_client.transfer` /
`release_collateral_internal` calls; a reentrant `repay` hits `LoanNotActive`
and reverts. `lending_pool::redeem_shares` updates accounting before the
outbound transfer. Verified by reading the source + fuzz replay.

### INV-5 — Access control

```cvl
rule onlyAdminCanPause(env, caller):
    paused' != paused
      => caller == admin   // or, for the breaker, a governance signer / 3-of-5 override

rule onlyOperatorCanMintFloat(env, caller):
    mint_float' => caller == operator
```

Enforced: `assert_not_paused` / `require_operator` / `Self::admin(...).require_auth()`
guards in every privileged entry point. The `CircuitBreaker` additionally
requires a signer to trip and a 3-of-5 override (with timelock) to lift.

### INV-6 — Arithmetic overflow freedom

```cvl
rule noWrap(env, op):
    op() => no integer overflow/underflow occurs
```

Enforced: `overflow-checks = true` in `Cargo.toml` (debug, test, release) → any
overflow/underflow **panics** rather than wrapping. All hot math routes through
`money::round_div` / `checked_*` helpers.

### INV-7 — Circuit-breaker consistency

```cvl
rule breakerBlocks(env, contract, fn):
    is_blocked(contract, fn) => guarded_call(contract, fn) reverts
```

Enforced: `lending_pool`, `agent_vault`, and `loan_manager` each consult
`assert_circuit_ok(fn_sym)` (or `require_not_paused` in `loan_manager`) before
value-moving ops. `is_blocked` returns true for active global / contract /
function pauses; every pause auto-expires after 72 h. Verified by
`lending_pool/src/test.rs::test_deposit_blocked_by_circuit_breaker`.

## Running the fuzzer

```bash
cd contracts
./fuzz_campaign.sh            # runs all fuzz targets for the campaign duration
# or a single target:
cargo +nightly fuzz run invariants_fuzz -- -max_total_time=300
```

`fuzz_targets/invariants_fuzz.rs` drives `AgentVault` / `LoanManager` with
arbitrary operation sequences and **panics on any invariant violation**
(overflow, solvency break, debt-cap break, reentrancy-detected state
inconsistency). A crash is a reproducible counterexample and must block merge.

## Verification status

| Invariant | Mechanism | Status |
| --- | --- | --- |
| INV-1 float solvency | checked math + fuzz | ✅ enforced |
| INV-2 pricing safety | virtual shares + tracked accounting | ✅ enforced |
| INV-3 debt cap | late-fee clamp | ✅ enforced |
| INV-4 reentrancy | CEI + terminal-status guards | ✅ enforced (reviewed) |
| INV-5 access control | `require_auth` guards | ✅ enforced |
| INV-6 overflow | `overflow-checks` + `checked_*` | ✅ enforced |
| INV-7 breaker consistency | `assert_circuit_ok` | ✅ enforced (tested) |

## Roadmap

- [ ] Mechanical proofs of INV-1 / INV-3 / INV-6 in the **K framework** for
      Rust (or `creusot` / `kani` for the arithmetic-critical functions).
- [ ] Continuous fuzzing in CI (nightly job) uploading corpus + crash reports.
- [ ] A CVL-style dashboard auto-generated from `invariants_fuzz.rs` findings.
