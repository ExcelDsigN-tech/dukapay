use crate::{AgentInfo, AgentStatus};
use soroban_sdk::{Address, Env, Symbol};

pub fn agent_registered(env: &Env, agent: &Address, info: &AgentInfo) {
    let topics = (Symbol::new(env, "AgentRegistered"), agent.clone());
    env.events().publish(
        topics,
        (info.kyc_ref.clone(), info.bond_amount, info.region.clone()),
    );
}

pub fn agent_status_changed(env: &Env, agent: &Address, from: AgentStatus, to: AgentStatus) {
    let topics = (Symbol::new(env, "AgentStatusChanged"), agent.clone());
    env.events().publish(topics, (from, to));
}

pub fn bond_updated(env: &Env, agent: &Address, new_bond: i128) {
    let topics = (Symbol::new(env, "BondUpdated"), agent.clone());
    env.events().publish(topics, new_bond);
}

pub fn reputation_updated(env: &Env, agent: &Address, old_reputation: i128, new_reputation: i128) {
    let topics = (Symbol::new(env, "ReputationUpdated"), agent.clone());
    env.events().publish(topics, (old_reputation, new_reputation));
}

pub fn license_renewed(env: &Env, agent: &Address, old_expiry: u64, new_expiry: u64) {
    let topics = (Symbol::new(env, "LicenseRenewed"), agent.clone());
    env.events().publish(topics, (old_expiry, new_expiry));
/// Emitted when the contract is patched in place via `upgrade`.
pub fn contract_upgraded(env: &Env, old_version: u32, new_version: u32) {
    let topics = (Symbol::new(env, "ContractUpgraded"),);
    env.events().publish(topics, (old_version, new_version));
}
