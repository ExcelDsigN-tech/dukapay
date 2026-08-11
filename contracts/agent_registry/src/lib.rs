#![no_std]
//! DukaPay agent registry contract.
//!
//! Onboards and tracks agents. An agent is a KYC'd, bonded shop owner who
//! operates a float vault. The registry is permissioned: only the trusted
//! operator (the DukaPay deployment backend) can register/activate/suspend;
//! the agent must authorize their own registration.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Symbol};

mod events;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    AgentAlreadyRegistered = 4,
    AgentNotFound = 5,
    InvalidBond = 6,
    MissingKyc = 7,
    InvalidStatusTransition = 8,
    BondFrozen = 9,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum AgentStatus {
    Pending,
    Active,
    Suspended,
    Expired,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentInfo {
    pub status: AgentStatus,
    /// Reference to the agent's KYC/AML attestation (off-chain record).
    pub kyc_ref: Symbol,
    /// USDC bond locked at onboarding. Custody lives in agent-vault; the
    /// registry is the source of truth for the "bonded" invariant.
    pub bond_amount: i128,
    pub license_expiry: u64,
    pub region: Symbol,
    pub reputation: i128,
}

#[contracttype]
pub enum DataKey {
    Owner,
    Operator,
    Agent(Address),
}

#[contract]
pub struct AgentRegistry;

#[contractimpl]
impl AgentRegistry {
    pub fn init(env: Env, owner: Address, operator: Address) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Owner) {
            return Err(RegistryError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Operator, &operator);
        Ok(())
    }

    fn owner(env: &Env) -> Result<Address, RegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(RegistryError::NotInitialized)
    }

    fn operator(env: &Env) -> Result<Address, RegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::Operator)
            .ok_or(RegistryError::NotInitialized)
    }

    fn require_operator(env: &Env) -> Result<(), RegistryError> {
        Self::operator(env)?.require_auth();
        Ok(())
    }

    fn get_info(env: &Env, agent: &Address) -> Result<AgentInfo, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Agent(agent.clone()))
            .ok_or(RegistryError::AgentNotFound)
    }

    fn set_info(env: &Env, agent: &Address, info: &AgentInfo) {
        env.storage()
            .persistent()
            .set(&DataKey::Agent(agent.clone()), info);
    }

    /// Operator registers an agent on behalf of the shop owner. The agent
    /// authorizes their own onboarding. Bond must be positive; the real USDC
    /// custody is held by agent-vault.
    pub fn register(
        env: Env,
        agent: Address,
        kyc_ref: Symbol,
        region: Symbol,
        bond_amount: i128,
        license_expiry: u64,
    ) -> Result<(), RegistryError> {
        agent.require_auth();
        Self::require_operator(&env)?;
        if bond_amount <= 0 {
            return Err(RegistryError::InvalidBond);
        }
        if env.storage().persistent().has(&DataKey::Agent(agent.clone())) {
            return Err(RegistryError::AgentAlreadyRegistered);
        }
        let info = AgentInfo {
            status: AgentStatus::Pending,
            kyc_ref,
            bond_amount,
            license_expiry,
            region,
            reputation: 0,
        };
        Self::set_info(&env, &agent, &info);
        events::agent_registered(&env, &agent, &info);
        Ok(())
    }

    /// Operator activates a Pending agent. Invariant: no active agent
    /// without a bond and a kyc_ref.
    pub fn activate(env: Env, agent: Address) -> Result<(), RegistryError> {
        Self::require_operator(&env)?;
        let mut info = Self::get_info(&env, &agent)?;
        if info.status != AgentStatus::Pending {
            return Err(RegistryError::InvalidStatusTransition);
        }
        if info.kyc_ref == Symbol::new(&env, "") {
            return Err(RegistryError::MissingKyc);
        }
        if info.bond_amount <= 0 {
            return Err(RegistryError::InvalidBond);
        }
        let from = info.status;
        info.status = AgentStatus::Active;
        Self::set_info(&env, &agent, &info);
        events::agent_status_changed(&env, &agent, from, info.status);
        Ok(())
    }

    /// Operator suspends an agent (e.g. AML flag). Bond stays frozen.
    pub fn suspend(env: Env, agent: Address) -> Result<(), RegistryError> {
        Self::require_operator(&env)?;
        let mut info = Self::get_info(&env, &agent)?;
        if info.status == AgentStatus::Suspended {
            return Err(RegistryError::InvalidStatusTransition);
        }
        let from = info.status;
        info.status = AgentStatus::Suspended;
        Self::set_info(&env, &agent, &info);
        events::agent_status_changed(&env, &agent, from, info.status);
        Ok(())
    }

    /// Operator updates an agent's reputation score (post-transaction trust).
    pub fn set_reputation(
        env: Env,
        agent: Address,
        reputation: i128,
    ) -> Result<(), RegistryError> {
        Self::require_operator(&env)?;
        let mut info = Self::get_info(&env, &agent)?;
        info.reputation = reputation;
        Self::set_info(&env, &agent, &info);
        Ok(())
    }

    /// Operator renews an agent's license.
    pub fn renew_license(env: Env, agent: Address, license_expiry: u64) -> Result<(), RegistryError> {
        Self::require_operator(&env)?;
        let mut info = Self::get_info(&env, &agent)?;
        info.license_expiry = license_expiry;
        Self::set_info(&env, &agent, &info);
        Ok(())
    }

    /// Operator increases an agent's bond. Bond is frozen while the agent is
    /// Active (float in circulation); increase is always allowed.
    pub fn top_up_bond(env: Env, agent: Address, amount: i128) -> Result<(), RegistryError> {
        Self::require_operator(&env)?;
        if amount <= 0 {
            return Err(RegistryError::InvalidBond);
        }
        let mut info = Self::get_info(&env, &agent)?;
        info.bond_amount = info
            .bond_amount
            .checked_add(amount)
            .ok_or(RegistryError::InvalidBond)?;
        Self::set_info(&env, &agent, &info);
        events::bond_updated(&env, &agent, info.bond_amount);
        Ok(())
    }

    /// Operator withdraws an agent's bond. Frozen while the agent is Active —
    /// a live agent must stay bonded. (The vault enforces float == 0 before
    /// releasing custody on the real USDC.)
    pub fn withdraw_bond(env: Env, agent: Address) -> Result<(), RegistryError> {
        Self::require_operator(&env)?;
        let mut info = Self::get_info(&env, &agent)?;
        if info.status == AgentStatus::Active {
            return Err(RegistryError::BondFrozen);
        }
        info.bond_amount = 0;
        Self::set_info(&env, &agent, &info);
        events::bond_updated(&env, &agent, 0);
        Ok(())
    }

    /// Read an agent's record.
    pub fn get_agent(env: Env, agent: Address) -> Result<AgentInfo, RegistryError> {
        Self::get_info(&env, &agent)
    }

    pub fn get_operator(env: Env) -> Result<Address, RegistryError> {
        Self::operator(&env)
    }

    pub fn get_owner(env: Env) -> Result<Address, RegistryError> {
        Self::owner(&env)
    }
}

#[cfg(test)]
mod test;
