#![no_std]
//! DukaPay Emergency Circuit Breaker.
//!
//! Provides a defense-in-depth kill switch for the protocol:
//!
//! * **Global pause** — halts every guarded function across all contracts.
//! * **Contract pause** — halts every guarded function of a single contract.
//! * **Function pause** — halts a single function on a single contract.
//!
//! Any member of the governance signer set (the "security council", by
//! default 5 members) may trip a pause. Lifting a pause requires a
//! **3-of-5 governance override**: a proposal must collect `threshold`
//! approvals and wait out a timelock before it can be executed. This keeps
//! the blast radius of a single compromised signer small while still allowing
//! a fast emergency stop.
//!
//! Every pause carries a **72-hour automatic expiry**. After the deadline the
//! pause is inert and guarded calls resume without any on-chain action, so a
//! forgotten pause cannot permanently freeze user funds.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Map, Symbol,
    Vec,
};

mod test;

// ─── Constants ────────────────────────────────────────────────────────────────

/// Maximum duration a pause stays in effect before it auto-expires: 72 h.
pub const PAUSE_DURATION_SECONDS: u64 = 259_200;

/// Default timelock that must elapse before a governance override executes.
const DEFAULT_OVERRIDE_TIMELOCK: u64 = 86_400; // 24 h

/// Minimum timelock for an override proposal (prevents instant overrides).
const MIN_OVERRIDE_TIMELOCK: u64 = 3_600; // 1 h

/// Upper bound on the governance signer set size (bounds iteration/storage).
const MAX_SIGNERS: u32 = 32;

/// Special function symbol used to denote a whole-contract pause within the
/// per-contract pause map.
pub const CONTRACT_WILDCARD: &str = "__all__";

const CURRENT_VERSION: u32 = 1;

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEY_ADMIN: Symbol = symbol_short!("ADMIN");
const KEY_SIGNERS: Symbol = symbol_short!("SIGNERS");
const KEY_THRESHOLD: Symbol = symbol_short!("THRESH");
const KEY_TIMELOCK: Symbol = symbol_short!("TLOCK");
const KEY_VERSION: Symbol = symbol_short!("VER");
const KEY_GLOBAL: Symbol = symbol_short!("GLOBAL");
/// `contract -> (function_symbol -> expiry_timestamp)`.
const KEY_STATE: Symbol = symbol_short!("STATE");
const KEY_OVERRIDES: Symbol = symbol_short!("OVERRIDES");
const KEY_OVERRIDE_COUNT: Symbol = symbol_short!("OCNT");

// ─── Errors ───────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum CircuitBreakerError {
    AlreadyInitialized = 5001,
    NotInitialized = 5002,
    Unauthorized = 5003,
    SignerNotAllowed = 5004,
    ThresholdTooLow = 5005,
    ThresholdExceedsSigners = 5006,
    TooManySigners = 5007,
    DuplicateSigner = 5008,
    EmptySignerList = 5009,
    TimelockTooShort = 5010,
    ProposalNotFound = 5011,
    ProposalNotActive = 5012,
    ProposalExpired = 5013,
    TimelockNotElapsed = 5014,
    ThresholdNotMet = 5015,
    AlreadyApproved = 5016,
}

// ─── Types ────────────────────────────────────────────────────────────────────

/// What a governance override proposal intends to unpause.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OverrideTarget {
    /// Lift the global pause.
    Global,
    /// Lift a whole-contract pause.
    Contract(Address),
    /// Lift a single-function pause.
    Function(Address, Symbol),
}

/// Lifecycle status of an override proposal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OverrideStatus {
    Active = 0,
    Executed = 1,
    Cancelled = 2,
}

/// A proposal to override (lift) a pause. Requires `threshold` signer
/// approvals and a timelock before it can be executed.
#[contracttype]
#[derive(Clone, Debug)]
pub struct OverrideProposal {
    pub id: u32,
    pub target: OverrideTarget,
    pub proposer: Address,
    pub proposed_at: u64,
    pub executable_after: u64,
    pub approvals: Map<Address, bool>,
    pub status: OverrideStatus,
}

/// Snapshot of the full breaker state for off-chain monitoring dashboards.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PauseState {
    pub global_expires_at: u64,
    pub contract_expiries: Map<Address, u64>,
    pub function_expiries: Map<Address, Map<Symbol, u64>>,
}

// ─── Events ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct PauseTriggeredEvent {
    pub scope: Symbol, // "global" | "contract" | "function"
    pub contract: Option<Address>,
    pub function: Option<Symbol>,
    pub triggered_by: Address,
    pub expires_at: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PauseLiftedEvent {
    pub scope: Symbol,
    pub contract: Option<Address>,
    pub function: Option<Symbol>,
    pub lifted_by: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct OverrideProposedEvent {
    pub id: u32,
    pub scope: Symbol,
    pub contract: Option<Address>,
    pub function: Option<Symbol>,
    pub proposer: Address,
    pub executable_after: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct OverrideApprovedEvent {
    pub id: u32,
    pub signer: Address,
    pub approvals_so_far: u32,
    pub threshold: u32,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct OverrideExecutedEvent {
    pub id: u32,
    pub scope: Symbol,
    pub contract: Option<Address>,
    pub function: Option<Symbol>,
    pub executed_by: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct OverrideCancelledEvent {
    pub id: u32,
    pub cancelled_by: Address,
    pub timestamp: u64,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct CircuitBreaker;

#[contractimpl]
impl CircuitBreaker {
    // ── Initialization ────────────────────────────────────────────────────────

    /// Initialize the circuit breaker.
    ///
    /// `admin`    — protocol admin (may rotate signers, threshold, timelock,
    ///              cancel proposals). Need not be a signer.
    /// `signers`  — governance security-council members (1..=MAX_SIGNERS).
    /// `threshold`— approvals required to execute an override (default 3).
    /// `override_timelock` — seconds the override must wait before executing
    ///              (default 24h, minimum 1h).
    pub fn initialize(
        env: Env,
        admin: Address,
        signers: Vec<Address>,
        threshold: u32,
        override_timelock: u64,
    ) -> Result<(), CircuitBreakerError> {
        if env.storage().instance().has(&KEY_ADMIN) {
            return Err(CircuitBreakerError::AlreadyInitialized);
        }
        if signers.is_empty() {
            return Err(CircuitBreakerError::EmptySignerList);
        }
        if signers.len() > MAX_SIGNERS {
            return Err(CircuitBreakerError::TooManySigners);
        }
        // Reject duplicate signers so a key cannot double-count toward quorum.
        let mut seen: Vec<Address> = Vec::new(&env);
        for s in signers.iter() {
            if seen.iter().any(|x| x == s) {
                return Err(CircuitBreakerError::DuplicateSigner);
            }
            seen.push_back(s);
        }
        if threshold < 1 {
            return Err(CircuitBreakerError::ThresholdTooLow);
        }
        if threshold > signers.len() {
            return Err(CircuitBreakerError::ThresholdExceedsSigners);
        }
        if override_timelock < MIN_OVERRIDE_TIMELOCK {
            return Err(CircuitBreakerError::TimelockTooShort);
        }

        env.storage().instance().set(&KEY_ADMIN, &admin);
        env.storage().instance().set(&KEY_SIGNERS, &signers);
        env.storage().instance().set(&KEY_THRESHOLD, &threshold);
        env.storage()
            .instance()
            .set(&KEY_TIMELOCK, &override_timelock);
        env.storage().instance().set(&KEY_VERSION, &CURRENT_VERSION);
        env.storage().instance().set(&KEY_OVERRIDE_COUNT, &0u32);
        let empty_state: Map<Address, Map<Symbol, u64>> = Map::new(&env);
        env.storage().instance().set(&KEY_STATE, &empty_state);
        // No global pause on init.

        env.events().publish(
            (Symbol::new(&env, "BreakerInit"),),
            (admin, signers.len(), threshold, override_timelock),
        );
        Ok(())
    }

    pub fn version(env: Env) -> u32 {
        env.storage().instance().get(&KEY_VERSION).unwrap_or(0)
    }

    // ── Admin (owner) configuration ───────────────────────────────────────────

    pub fn set_admin(
        env: Env,
        caller: Address,
        new_admin: Address,
    ) -> Result<(), CircuitBreakerError> {
        caller.require_auth();
        Self::read_admin(&env)?.require_auth();
        env.storage().instance().set(&KEY_ADMIN, &new_admin);
        env.events()
            .publish((Symbol::new(&env, "BreakerAdmin"),), (caller, new_admin));
        Ok(())
    }

    pub fn set_signers(
        env: Env,
        caller: Address,
        signers: Vec<Address>,
        threshold: u32,
    ) -> Result<(), CircuitBreakerError> {
        caller.require_auth();
        Self::read_admin(&env)?.require_auth();
        if signers.is_empty() {
            return Err(CircuitBreakerError::EmptySignerList);
        }
        if signers.len() > MAX_SIGNERS {
            return Err(CircuitBreakerError::TooManySigners);
        }
        let mut seen: Vec<Address> = Vec::new(&env);
        for s in signers.iter() {
            if seen.iter().any(|x| x == s) {
                return Err(CircuitBreakerError::DuplicateSigner);
            }
            seen.push_back(s);
        }
        if threshold < 1 {
            return Err(CircuitBreakerError::ThresholdTooLow);
        }
        if threshold > signers.len() {
            return Err(CircuitBreakerError::ThresholdExceedsSigners);
        }
        env.storage().instance().set(&KEY_SIGNERS, &signers);
        env.storage().instance().set(&KEY_THRESHOLD, &threshold);
        Ok(())
    }

    pub fn set_override_timelock(
        env: Env,
        caller: Address,
        override_timelock: u64,
    ) -> Result<(), CircuitBreakerError> {
        caller.require_auth();
        Self::read_admin(&env)?.require_auth();
        if override_timelock < MIN_OVERRIDE_TIMELOCK {
            return Err(CircuitBreakerError::TimelockTooShort);
        }
        env.storage()
            .instance()
            .set(&KEY_TIMELOCK, &override_timelock);
        Ok(())
    }

    // ── Pause (any signer may trip) ───────────────────────────────────────────

    /// Trip the global pause. Any governance signer may call this; it expires
    /// automatically after 72 hours.
    pub fn pause_all(env: Env, caller: Address) -> Result<(), CircuitBreakerError> {
        caller.require_auth();
        Self::require_signer(&env, &caller)?;
        let expires_at = Self::pause_expiry(&env);
        env.storage().instance().set(&KEY_GLOBAL, &expires_at);
        let now = env.ledger().timestamp();
        env.events().publish(
            (Symbol::new(&env, "Paused"), symbol_short!("global")),
            PauseTriggeredEvent {
                scope: Symbol::new(&env, "global"),
                contract: None,
                function: None,
                triggered_by: caller,
                expires_at,
                timestamp: now,
            },
        );
        Ok(())
    }

    /// Trip a whole-contract pause.
    pub fn pause_contract(
        env: Env,
        caller: Address,
        contract: Address,
    ) -> Result<(), CircuitBreakerError> {
        caller.require_auth();
        Self::require_signer(&env, &caller)?;
        let expires_at = Self::pause_expiry(&env);
        let wildcard = Self::wildcard(&env);
        Self::set_pause(&env, &contract, &wildcard, expires_at);
        let now = env.ledger().timestamp();
        env.events().publish(
            (Symbol::new(&env, "Paused"), symbol_short!("contract")),
            PauseTriggeredEvent {
                scope: Symbol::new(&env, "contract"),
                contract: Some(contract),
                function: None,
                triggered_by: caller,
                expires_at,
                timestamp: now,
            },
        );
        Ok(())
    }

    /// Trip a single-function pause.
    pub fn pause_function(
        env: Env,
        caller: Address,
        contract: Address,
        function: Symbol,
    ) -> Result<(), CircuitBreakerError> {
        caller.require_auth();
        Self::require_signer(&env, &caller)?;
        let expires_at = Self::pause_expiry(&env);
        Self::set_pause(&env, &contract, &function, expires_at);
        let now = env.ledger().timestamp();
        env.events().publish(
            (Symbol::new(&env, "Paused"), symbol_short!("function")),
            PauseTriggeredEvent {
                scope: Symbol::new(&env, "function"),
                contract: Some(contract),
                function: Some(function),
                triggered_by: caller,
                expires_at,
                timestamp: now,
            },
        );
        Ok(())
    }

    // ── Governance override (3-of-5) ──────────────────────────────────────────

    /// Propose lifting a pause. The proposer must be a governance signer.
    /// The proposal becomes executable only after both the timelock elapses
    /// AND `threshold` approvals are collected.
    pub fn propose_override(
        env: Env,
        proposer: Address,
        target: OverrideTarget,
    ) -> Result<u32, CircuitBreakerError> {
        proposer.require_auth();
        Self::require_signer(&env, &proposer)?;

        let timelock: u64 = env
            .storage()
            .instance()
            .get(&KEY_TIMELOCK)
            .unwrap_or(DEFAULT_OVERRIDE_TIMELOCK);
        let now = env.ledger().timestamp();
        let executable_after = now.saturating_add(timelock);

        let count: u32 = env
            .storage()
            .instance()
            .get(&KEY_OVERRIDE_COUNT)
            .unwrap_or(0);
        let id = count + 1;
        env.storage().instance().set(&KEY_OVERRIDE_COUNT, &id);

        let proposal = OverrideProposal {
            id,
            target: target.clone(),
            proposer: proposer.clone(),
            proposed_at: now,
            executable_after,
            approvals: Map::new(&env),
            status: OverrideStatus::Active,
        };
        Self::write_proposal(&env, &proposal);

        let (scope, contract, function) = Self::describe_target(&env, &target);
        env.events().publish(
            (Symbol::new(&env, "OverrideProp"), scope.clone()),
            OverrideProposedEvent {
                id,
                scope,
                contract,
                function,
                proposer,
                executable_after,
                timestamp: now,
            },
        );
        Ok(id)
    }

    /// Cast a signer approval on an override proposal. Idempotent per signer.
    pub fn approve_override(
        env: Env,
        signer: Address,
        proposal_id: u32,
    ) -> Result<(), CircuitBreakerError> {
        signer.require_auth();
        Self::require_signer(&env, &signer)?;

        let mut proposal = Self::read_proposal(&env, proposal_id)?;
        if proposal.status != OverrideStatus::Active {
            return Err(CircuitBreakerError::ProposalNotActive);
        }
        if proposal.approvals.get(signer.clone()).unwrap_or(false) {
            return Err(CircuitBreakerError::AlreadyApproved);
        }
        proposal.approvals.set(signer.clone(), true);
        let approvals_so_far = proposal.approvals.len();
        let threshold: u32 = env.storage().instance().get(&KEY_THRESHOLD).unwrap_or(0);
        Self::write_proposal(&env, &proposal);

        env.events().publish(
            (Symbol::new(&env, "OverrideAppr"), signer.clone()),
            OverrideApprovedEvent {
                id: proposal_id,
                signer,
                approvals_so_far,
                threshold,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    /// Execute an override proposal: lift the targeted pause. Requires the
    /// timelock to have elapsed and `threshold` approvals to be present.
    pub fn execute_override(
        env: Env,
        caller: Address,
        proposal_id: u32,
    ) -> Result<(), CircuitBreakerError> {
        caller.require_auth();
        let mut proposal = Self::read_proposal(&env, proposal_id)?;
        if proposal.status != OverrideStatus::Active {
            return Err(CircuitBreakerError::ProposalNotActive);
        }

        let now = env.ledger().timestamp();
        if now < proposal.executable_after {
            return Err(CircuitBreakerError::TimelockNotElapsed);
        }
        // Safety: a proposal older than the 72h auto-expiry of the pause it
        // targets may reference stale state; require execution within a
        // bounded window so overrides cannot linger indefinitely.
        let proposal_ttl = proposal
            .executable_after
            .saturating_add(PAUSE_DURATION_SECONDS);
        if now >= proposal_ttl {
            return Err(CircuitBreakerError::ProposalExpired);
        }

        let threshold: u32 = env.storage().instance().get(&KEY_THRESHOLD).unwrap_or(0);
        if proposal.approvals.len() < threshold {
            return Err(CircuitBreakerError::ThresholdNotMet);
        }

        Self::apply_override(&env, &proposal.target);

        proposal.status = OverrideStatus::Executed;
        Self::write_proposal(&env, &proposal);

        let (scope, contract, function) = Self::describe_target(&env, &proposal.target);
        env.events().publish(
            (Symbol::new(&env, "OverrideExec"), scope.clone()),
            OverrideExecutedEvent {
                id: proposal_id,
                scope,
                contract,
                function,
                executed_by: caller,
                timestamp: now,
            },
        );
        Ok(())
    }

    /// Cancel an override proposal. Only the admin may do this.
    pub fn cancel_override(
        env: Env,
        caller: Address,
        proposal_id: u32,
    ) -> Result<(), CircuitBreakerError> {
        caller.require_auth();
        Self::read_admin(&env)?.require_auth();
        let mut proposal = Self::read_proposal(&env, proposal_id)?;
        if proposal.status != OverrideStatus::Active {
            return Err(CircuitBreakerError::ProposalNotActive);
        }
        proposal.status = OverrideStatus::Cancelled;
        Self::write_proposal(&env, &proposal);
        env.events().publish(
            (Symbol::new(&env, "OverrideCanc"), proposal_id),
            OverrideCancelledEvent {
                id: proposal_id,
                cancelled_by: caller,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    // ── Queries (off-chain monitoring) ────────────────────────────────────────

    /// Returns `true` if `function` on `contract` is currently blocked by any
    /// active (non-expired) pause: global, contract-wide, or function-level.
    ///
    /// Guarded contracts call this at the top of sensitive entry points.
    pub fn is_blocked(env: Env, contract: Address, function: Symbol) -> bool {
        let now = env.ledger().timestamp();

        // Global pause.
        if let Some(expiry) = env.storage().instance().get::<Symbol, u64>(&KEY_GLOBAL) {
            if now < expiry {
                return true;
            }
        }

        let state: Map<Address, Map<Symbol, u64>> = env
            .storage()
            .instance()
            .get(&KEY_STATE)
            .unwrap_or(Map::new(&env));

        if let Some(inner) = state.get(contract.clone()) {
            let wildcard = Self::wildcard(&env);
            if let Some(expiry) = inner.get(wildcard) {
                if now < expiry {
                    return true;
                }
            }
            if let Some(expiry) = inner.get(function) {
                if now < expiry {
                    return true;
                }
            }
        }
        false
    }

    pub fn is_globally_paused(env: Env) -> bool {
        let now = env.ledger().timestamp();
        if let Some(expiry) = env.storage().instance().get::<Symbol, u64>(&KEY_GLOBAL) {
            return now < expiry;
        }
        false
    }

    pub fn is_contract_paused(env: Env, contract: Address) -> bool {
        let now = env.ledger().timestamp();
        let state: Map<Address, Map<Symbol, u64>> = env
            .storage()
            .instance()
            .get(&KEY_STATE)
            .unwrap_or(Map::new(&env));
        if let Some(inner) = state.get(contract) {
            let wildcard = Self::wildcard(&env);
            if let Some(expiry) = inner.get(wildcard) {
                return now < expiry;
            }
        }
        false
    }

    pub fn is_function_paused(env: Env, contract: Address, function: Symbol) -> bool {
        let now = env.ledger().timestamp();
        let wildcard = Self::wildcard(&env);
        let state: Map<Address, Map<Symbol, u64>> = env
            .storage()
            .instance()
            .get(&KEY_STATE)
            .unwrap_or(Map::new(&env));
        if let Some(inner) = state.get(contract.clone()) {
            if let Some(expiry) = inner.get(function) {
                if now < expiry {
                    return true;
                }
            }
            // A contract-wide pause also blocks the specific function.
            if let Some(expiry) = inner.get(wildcard) {
                if now < expiry {
                    return true;
                }
            }
        }
        false
    }

    /// Full snapshot of current pause expiries.
    pub fn get_pause_state(env: Env) -> PauseState {
        let now = env.ledger().timestamp();
        let global_expires_at = env
            .storage()
            .instance()
            .get::<Symbol, u64>(&KEY_GLOBAL)
            .filter(|e| now < *e)
            .unwrap_or(0);

        let state: Map<Address, Map<Symbol, u64>> = env
            .storage()
            .instance()
            .get(&KEY_STATE)
            .unwrap_or(Map::new(&env));

        let mut contract_expiries: Map<Address, u64> = Map::new(&env);
        let mut function_expiries: Map<Address, Map<Symbol, u64>> = Map::new(&env);
        for contract in state.keys() {
            if let Some(inner) = state.get(contract.clone()) {
                let wildcard = Self::wildcard(&env);
                if let Some(expiry) = inner.get(wildcard.clone()) {
                    if now < expiry {
                        contract_expiries.set(contract.clone(), expiry);
                    }
                }
                let mut fmap: Map<Symbol, u64> = Map::new(&env);
                for func in inner.keys() {
                    if func == wildcard {
                        continue;
                    }
                    if let Some(expiry) = inner.get(func.clone()) {
                        if now < expiry {
                            fmap.set(func, expiry);
                        }
                    }
                }
                if !fmap.is_empty() {
                    function_expiries.set(contract, fmap);
                }
            }
        }

        PauseState {
            global_expires_at,
            contract_expiries,
            function_expiries,
        }
    }

    pub fn get_admin(env: Env) -> Result<Address, CircuitBreakerError> {
        Self::read_admin(&env)
    }

    pub fn get_signers(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&KEY_SIGNERS)
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_threshold(env: Env) -> u32 {
        env.storage().instance().get(&KEY_THRESHOLD).unwrap_or(0)
    }

    pub fn get_override_timelock(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&KEY_TIMELOCK)
            .unwrap_or(DEFAULT_OVERRIDE_TIMELOCK)
    }

    pub fn get_proposal(
        env: Env,
        proposal_id: u32,
    ) -> Result<OverrideProposal, CircuitBreakerError> {
        Self::read_proposal(&env, proposal_id)
    }

    pub fn get_override_count(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&KEY_OVERRIDE_COUNT)
            .unwrap_or(0)
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn wildcard(env: &Env) -> Symbol {
        Symbol::new(env, CONTRACT_WILDCARD)
    }

    fn pause_expiry(env: &Env) -> u64 {
        env.ledger()
            .timestamp()
            .saturating_add(PAUSE_DURATION_SECONDS)
    }

    fn set_pause(env: &Env, contract: &Address, function: &Symbol, expires_at: u64) {
        let mut state: Map<Address, Map<Symbol, u64>> = env
            .storage()
            .instance()
            .get(&KEY_STATE)
            .unwrap_or(Map::new(env));
        let mut inner = state.get(contract.clone()).unwrap_or(Map::new(env));
        inner.set(function.clone(), expires_at);
        state.set(contract.clone(), inner);
        env.storage().instance().set(&KEY_STATE, &state);
    }

    fn clear_pause(env: &Env, contract: &Address, function: &Symbol) {
        let mut state: Map<Address, Map<Symbol, u64>> = env
            .storage()
            .instance()
            .get(&KEY_STATE)
            .unwrap_or(Map::new(env));
        if let Some(mut inner) = state.get(contract.clone()) {
            inner.remove(function.clone());
            if inner.is_empty() {
                state.remove(contract.clone());
            } else {
                state.set(contract.clone(), inner);
            }
            env.storage().instance().set(&KEY_STATE, &state);
        }
    }

    fn apply_override(env: &Env, target: &OverrideTarget) {
        match target {
            OverrideTarget::Global => {
                env.storage().instance().remove(&KEY_GLOBAL);
                env.events().publish(
                    (Symbol::new(env, "Lifted"), symbol_short!("global")),
                    PauseLiftedEvent {
                        scope: Symbol::new(env, "global"),
                        contract: None,
                        function: None,
                        lifted_by: env.current_contract_address(),
                        timestamp: env.ledger().timestamp(),
                    },
                );
            }
            OverrideTarget::Contract(c) => {
                let wildcard = Self::wildcard(env);
                Self::clear_pause(env, c, &wildcard);
                env.events().publish(
                    (Symbol::new(env, "Lifted"), symbol_short!("contract")),
                    PauseLiftedEvent {
                        scope: Symbol::new(env, "contract"),
                        contract: Some(c.clone()),
                        function: None,
                        lifted_by: env.current_contract_address(),
                        timestamp: env.ledger().timestamp(),
                    },
                );
            }
            OverrideTarget::Function(c, f) => {
                Self::clear_pause(env, c, f);
                env.events().publish(
                    (Symbol::new(env, "Lifted"), symbol_short!("function")),
                    PauseLiftedEvent {
                        scope: Symbol::new(env, "function"),
                        contract: Some(c.clone()),
                        function: Some(f.clone()),
                        lifted_by: env.current_contract_address(),
                        timestamp: env.ledger().timestamp(),
                    },
                );
            }
        }
    }

    fn describe_target(
        env: &Env,
        target: &OverrideTarget,
    ) -> (Symbol, Option<Address>, Option<Symbol>) {
        match target {
            OverrideTarget::Global => (Symbol::new(env, "global"), None, None),
            OverrideTarget::Contract(c) => (Symbol::new(env, "contract"), Some(c.clone()), None),
            OverrideTarget::Function(c, f) => (
                Symbol::new(env, "function"),
                Some(c.clone()),
                Some(f.clone()),
            ),
        }
    }

    fn read_admin(env: &Env) -> Result<Address, CircuitBreakerError> {
        env.storage()
            .instance()
            .get(&KEY_ADMIN)
            .ok_or(CircuitBreakerError::NotInitialized)
    }

    fn read_proposal(env: &Env, proposal_id: u32) -> Result<OverrideProposal, CircuitBreakerError> {
        let proposals: Map<u32, OverrideProposal> = env
            .storage()
            .instance()
            .get(&KEY_OVERRIDES)
            .unwrap_or(Map::new(env));
        proposals
            .get(proposal_id)
            .ok_or(CircuitBreakerError::ProposalNotFound)
    }

    fn write_proposal(env: &Env, proposal: &OverrideProposal) {
        let mut proposals: Map<u32, OverrideProposal> = env
            .storage()
            .instance()
            .get(&KEY_OVERRIDES)
            .unwrap_or(Map::new(env));
        proposals.set(proposal.id, proposal.clone());
        env.storage().instance().set(&KEY_OVERRIDES, &proposals);
    }

    fn require_signer(env: &Env, signer: &Address) -> Result<(), CircuitBreakerError> {
        let signers: Vec<Address> = env
            .storage()
            .instance()
            .get(&KEY_SIGNERS)
            .unwrap_or(Vec::new(env));
        for s in signers.iter() {
            if &s == signer {
                return Ok(());
            }
        }
        Err(CircuitBreakerError::SignerNotAllowed)
    }
}
