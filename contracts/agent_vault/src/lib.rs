#![no_std]
//! DukaPay agent vault contract.
//!
//! Holds each agent's USDC collateral and tracks their on-chain float
//! (stablecoin credit issued against that collateral). The solvency
//! invariant: float <= collateral * haircut_bps / 10_000 at all times —
//! an agent can never be short against their own collateral. A global
//! `min_collateral` floor keeps live agents meaningfully capitalised while
//! any float is outstanding; full exit is only possible at float == 0.
//!
//! The operator (DukaPay settlement backend) mints/burns float and nets
//! end-of-day positions; the agent authorises their own collateral moves
//! and float transfers. Minting is always bounded by the solvency rule.

use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, Address, Env, Symbol, Vec,
};

mod events;

/// Interface exposed by the DukaPay `CircuitBreaker` contract. The vault
/// consults `is_blocked` at the top of every value-moving entry point.
#[contractclient(name = "BreakerClient")]
pub trait BreakerInterface {
    fn is_blocked(env: Env, contract: Address, function: Symbol) -> bool;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum VaultError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    AgentNotFound = 4,
    InvalidAmount = 5,
    InsufficientCollateral = 6,
    InsufficientFloat = 7,
    SolvencyViolated = 8,
    InvalidHaircut = 9,
    InvalidParams = 10,
    MinCollateralViolated = 11,
    NetNotZero = 12,
    BatchTooLarge = 13,
    /// A global, contract, or function-level circuit-breaker pause is active.
    CircuitBreakerTripped = 14,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Vault {
    pub collateral: i128,
    pub float: i128,
    /// Fraction of collateral that may back float, in basis points.
    pub haircut_bps: u32,
    /// Ledger timestamp of the last settle_net touching this vault.
    pub last_settled: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Params {
    pub max_haircut_bps: u32,
    pub min_collateral: i128,
}

#[contracttype]
pub enum DataKey {
    Owner,
    Operator,
    Token,
    Params,
    /// Optional address of the DukaPay CircuitBreaker contract. When set, the
    /// vault consults it before executing value-moving operations.
    CircuitBreaker,
    Vault(Address),
}

#[contract]
pub struct AgentVault;

#[contractimpl]
impl AgentVault {
    const BPS: i128 = 10_000;
    const INSTANCE_TTL_THRESHOLD: u32 = 17_280;
    const INSTANCE_TTL_BUMP: u32 = 518_400;
    const PERSISTENT_TTL_THRESHOLD: u32 = 17_280;
    const PERSISTENT_TTL_BUMP: u32 = 518_400;
    const BATCH_MAX: u32 = 100;

    // ── TTL helpers ───────────────────────────────────────────────────────

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(Self::INSTANCE_TTL_THRESHOLD, Self::INSTANCE_TTL_BUMP);
    }

    fn bump_persistent_ttl(env: &Env, key: &DataKey) {
        env.storage().persistent().extend_ttl(
            key,
            Self::PERSISTENT_TTL_THRESHOLD,
            Self::PERSISTENT_TTL_BUMP,
        );
    }

    // ── Storage accessors ─────────────────────────────────────────────────

    fn owner(env: &Env) -> Result<Address, VaultError> {
        env.storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(VaultError::NotInitialized)
    }

    fn operator(env: &Env) -> Result<Address, VaultError> {
        env.storage()
            .instance()
            .get(&DataKey::Operator)
            .ok_or(VaultError::NotInitialized)
    }

    fn token(env: &Env) -> Result<Address, VaultError> {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(VaultError::NotInitialized)
    }

    fn params(env: &Env) -> Result<Params, VaultError> {
        env.storage()
            .instance()
            .get(&DataKey::Params)
            .ok_or(VaultError::NotInitialized)
    }

    fn require_operator(env: &Env) -> Result<(), VaultError> {
        Self::operator(env)?.require_auth();
        Ok(())
    }

    /// Revert if the configured `CircuitBreaker` has tripped a pause that
    /// covers this vault and `fn_sym`. When no breaker is configured this is
    /// a no-op, so the vault remains fully backward compatible.
    fn assert_circuit_ok(env: &Env, fn_sym: Symbol) -> Result<(), VaultError> {
        Self::bump_instance_ttl(env);
        if let Some(breaker) = env
            .storage()
            .instance()
            .get::<_, Option<Address>>(&DataKey::CircuitBreaker)
            .flatten()
        {
            let client = BreakerClient::new(env, &breaker);
            if client.is_blocked(&env.current_contract_address(), &fn_sym) {
                return Err(VaultError::CircuitBreakerTripped);
            }
        }
        Ok(())
    }

    fn read_vault(env: &Env, agent: &Address) -> Vault {
        Self::bump_instance_ttl(env);
        let key = DataKey::Vault(agent.clone());
        let vault: Option<Vault> = env.storage().persistent().get(&key);
        if vault.is_some() {
            Self::bump_persistent_ttl(env, &key);
        }
        vault.unwrap_or(Vault {
            collateral: 0,
            float: 0,
            haircut_bps: 0,
            last_settled: 0,
        })
    }

    fn write_vault(env: &Env, agent: &Address, vault: &Vault) {
        let key = DataKey::Vault(agent.clone());
        env.storage().persistent().set(&key, vault);
        Self::bump_persistent_ttl(env, &key);
    }

    /// Float that `collateral` may back at `haircut_bps`. Clamped so the
    /// result can never exceed `collateral`.
    fn max_float_of(collateral: i128, haircut_bps: u32) -> i128 {
        let haircut = i128::from(haircut_bps.min(Self::BPS as u32));
        collateral
            .checked_mul(haircut)
            .map(|v| v / Self::BPS)
            .unwrap_or(i128::MAX)
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    /// One-time init. `max_haircut_bps` must be in `1..=10_000`;
    /// `min_collateral` must be non-negative.
    pub fn init(
        env: Env,
        owner: Address,
        operator: Address,
        token: Address,
        max_haircut_bps: u32,
        min_collateral: i128,
    ) -> Result<(), VaultError> {
        if env.storage().instance().has(&DataKey::Owner) {
            return Err(VaultError::AlreadyInitialized);
        }
        if max_haircut_bps == 0 || max_haircut_bps > 10_000 {
            return Err(VaultError::InvalidParams);
        }
        if min_collateral < 0 {
            return Err(VaultError::InvalidParams);
        }
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Operator, &operator);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(
            &DataKey::Params,
            &Params {
                max_haircut_bps,
                min_collateral,
            },
        );
        Self::bump_instance_ttl(&env);
        Ok(())
    }

    // ── Collateral ────────────────────────────────────────────────────────

    /// Agent posts USDC collateral. A vault is created on first deposit with
    /// the default haircut (the global maximum).
    pub fn deposit_collateral(env: Env, agent: Address, amount: i128) -> Result<(), VaultError> {
        agent.require_auth();
        Self::assert_circuit_ok(&env, Symbol::new(&env, "deposit_collateral"))?;
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        let token = Self::token(&env)?;
        let mut vault = Self::read_vault(&env, &agent);
        if vault.haircut_bps == 0 {
            vault.haircut_bps = Self::params(&env)?.max_haircut_bps;
        }
        vault.collateral = vault
            .collateral
            .checked_add(amount)
            .ok_or(VaultError::InvalidAmount)?;
        TokenClient::new(&env, &token).transfer(&agent, &env.current_contract_address(), &amount);
        Self::write_vault(&env, &agent, &vault);
        events::collateral_deposited(&env, &agent, amount, vault.collateral);
        Ok(())
    }

    /// Agent withdraws collateral. While float is outstanding the vault must
    /// stay above `min_collateral` and solvency must hold after the move.
    /// Full exit (down to zero) is only allowed when float == 0.
    pub fn withdraw_collateral(env: Env, agent: Address, amount: i128) -> Result<(), VaultError> {
        agent.require_auth();
        Self::assert_circuit_ok(&env, Symbol::new(&env, "withdraw_collateral"))?;
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        let token = Self::token(&env)?;
        let params = Self::params(&env)?;
        let mut vault = Self::read_vault(&env, &agent);
        if amount > vault.collateral {
            return Err(VaultError::InsufficientCollateral);
        }
        let remaining = vault.collateral - amount;
        if vault.float > 0 {
            if remaining < params.min_collateral {
                return Err(VaultError::MinCollateralViolated);
            }
            if vault.float > Self::max_float_of(remaining, vault.haircut_bps) {
                return Err(VaultError::SolvencyViolated);
            }
        }
        vault.collateral = remaining;
        TokenClient::new(&env, &token).transfer(&env.current_contract_address(), &agent, &amount);
        Self::write_vault(&env, &agent, &vault);
        events::collateral_withdrawn(&env, &agent, amount, vault.collateral);
        Ok(())
    }

    // ── Float ─────────────────────────────────────────────────────────────

    /// Operator mints float (cash-in credit) up to the collateral bound.
    pub fn mint_float(env: Env, agent: Address, amount: i128) -> Result<(), VaultError> {
        Self::require_operator(&env)?;
        Self::assert_circuit_ok(&env, Symbol::new(&env, "mint_float"))?;
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        let mut vault = Self::read_vault(&env, &agent);
        let new_float = vault
            .float
            .checked_add(amount)
            .ok_or(VaultError::InvalidAmount)?;
        if new_float > Self::max_float_of(vault.collateral, vault.haircut_bps) {
            return Err(VaultError::SolvencyViolated);
        }
        vault.float = new_float;
        Self::write_vault(&env, &agent, &vault);
        events::float_minted(&env, &agent, amount, vault.float);
        Ok(())
    }

    /// Agent burns float (cash-out redemption) from their own balance.
    pub fn burn_float(env: Env, agent: Address, amount: i128) -> Result<(), VaultError> {
        agent.require_auth();
        Self::assert_circuit_ok(&env, Symbol::new(&env, "burn_float"))?;
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        let mut vault = Self::read_vault(&env, &agent);
        if amount > vault.float {
            return Err(VaultError::InsufficientFloat);
        }
        vault.float -= amount;
        Self::write_vault(&env, &agent, &vault);
        events::float_burned(&env, &agent, amount, vault.float);
        Ok(())
    }

    /// Atomic float transfer between agents. Both must authorise. The
    /// recipient's float must stay within their own collateral bound.
    pub fn transfer_float(
        env: Env,
        from: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), VaultError> {
        // `from` and `to` must differ: read_vault(from) and read_vault(to)
        // would otherwise alias the same storage key, and the second
        // write_vault call below would silently clobber the first, minting
        // `amount` of float out of thin air for the agent on every
        // self-transfer. Checked before require_auth so a self-transfer
        // never needs (and can't double-request) authorization for the
        // same address.
        if from == to {
            return Err(VaultError::InvalidParams);
        }
        from.require_auth();
        to.require_auth();
        Self::assert_circuit_ok(&env, Symbol::new(&env, "transfer_float"))?;
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        let mut from_vault = Self::read_vault(&env, &from);
        let mut to_vault = Self::read_vault(&env, &to);
        if amount > from_vault.float {
            return Err(VaultError::InsufficientFloat);
        }
        let to_float = to_vault
            .float
            .checked_add(amount)
            .ok_or(VaultError::InvalidAmount)?;
        if to_float > Self::max_float_of(to_vault.collateral, to_vault.haircut_bps) {
            return Err(VaultError::SolvencyViolated);
        }
        from_vault.float -= amount;
        to_vault.float = to_float;
        Self::write_vault(&env, &from, &from_vault);
        Self::write_vault(&env, &to, &to_vault);
        events::float_transferred(&env, &from, &to, amount);
        Ok(())
    }

    /// Operator nets end-of-day positions. `entries` is a list of
    /// `(agent, delta)`; deltas must sum to zero (float conserved across the
    /// batch). Each agent's resulting float must stay in `[0, max_float]`.
    pub fn settle_net(env: Env, entries: Vec<(Address, i128)>) -> Result<(), VaultError> {
        Self::require_operator(&env)?;
        Self::assert_circuit_ok(&env, Symbol::new(&env, "settle_net"))?;
        if entries.len() > Self::BATCH_MAX {
            return Err(VaultError::BatchTooLarge);
        }
        let mut sum: i128 = 0;
        for entry in entries.iter() {
            sum = sum.checked_add(entry.1).ok_or(VaultError::NetNotZero)?;
        }
        if sum != 0 {
            return Err(VaultError::NetNotZero);
        }
        let timestamp = env.ledger().timestamp();
        for entry in entries.iter() {
            let agent = entry.0;
            let delta = entry.1;
            let mut vault = Self::read_vault(&env, &agent);
            let new_float = vault
                .float
                .checked_add(delta)
                .ok_or(VaultError::InsufficientFloat)?;
            if new_float < 0 {
                return Err(VaultError::InsufficientFloat);
            }
            if new_float > Self::max_float_of(vault.collateral, vault.haircut_bps) {
                return Err(VaultError::SolvencyViolated);
            }
            vault.float = new_float;
            vault.last_settled = timestamp;
            Self::write_vault(&env, &agent, &vault);
            events::vault_settled(&env, &agent, delta, vault.float);
        }
        Ok(())
    }

    // ── Configuration ─────────────────────────────────────────────────────

    /// Operator adjusts an agent's haircut. Must stay within the global
    /// maximum and must not break solvency with the float already issued.
    pub fn set_haircut(env: Env, agent: Address, new_haircut_bps: u32) -> Result<(), VaultError> {
        Self::require_operator(&env)?;
        let params = Self::params(&env)?;
        if new_haircut_bps == 0 || new_haircut_bps > params.max_haircut_bps {
            return Err(VaultError::InvalidHaircut);
        }
        let mut vault = Self::read_vault(&env, &agent);
        if vault.float > Self::max_float_of(vault.collateral, new_haircut_bps) {
            return Err(VaultError::SolvencyViolated);
        }
        let old = vault.haircut_bps;
        vault.haircut_bps = new_haircut_bps;
        Self::write_vault(&env, &agent, &vault);
        events::haircut_updated(&env, &agent, old, new_haircut_bps);
        Ok(())
    }

    // ── Views ─────────────────────────────────────────────────────────────

    pub fn get_vault(env: Env, agent: Address) -> Vault {
        Self::read_vault(&env, &agent)
    }

    pub fn max_float(env: Env, agent: Address) -> i128 {
        let vault = Self::read_vault(&env, &agent);
        Self::max_float_of(vault.collateral, vault.haircut_bps)
    }

    pub fn get_params(env: Env) -> Result<Params, VaultError> {
        Self::params(&env)
    }

    pub fn get_token(env: Env) -> Result<Address, VaultError> {
        Self::token(&env)
    }

    pub fn get_operator(env: Env) -> Result<Address, VaultError> {
        Self::operator(&env)
    }

    pub fn get_owner(env: Env) -> Result<Address, VaultError> {
        Self::owner(&env)
    }

    /// Configure (or clear with `None`) the `CircuitBreaker` contract address
    /// the vault consults before value-moving operations. Owner only.
    pub fn set_circuit_breaker(env: Env, breaker: Option<Address>) -> Result<(), VaultError> {
        Self::owner(&env)?.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::CircuitBreaker, &breaker);
        Self::bump_instance_ttl(&env);
        events::vault_circuit_breaker_set(&env, breaker);
        Ok(())
    }

    /// True when the active `CircuitBreaker` currently blocks this vault and
    /// `function`. Returns false when no breaker is configured.
    pub fn is_circuit_blocked(env: Env, function: Symbol) -> bool {
        Self::bump_instance_ttl(&env);
        if let Some(breaker) = env
            .storage()
            .instance()
            .get::<_, Option<Address>>(&DataKey::CircuitBreaker)
            .flatten()
        {
            let client = BreakerClient::new(&env, &breaker);
            return client.is_blocked(&env.current_contract_address(), &function);
        }
        false
    }
}

#[cfg(test)]
mod test;
