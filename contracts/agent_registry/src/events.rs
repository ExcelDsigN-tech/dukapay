use crate::{AgentInfo, AgentStatus};
use soroban_sdk::{Address, Env, Symbol};

pub fn agent_registered(env: &Env, agent: &Address, info: &AgentInfo) {
    let topics = (Symbol::new(env, "AgentRegistered"), agent.clone());
    env.events()
        .publish(topics, (info.kyc_ref.clone(), info.bond_amount, info.region.clone()));
}

pub fn agent_status_changed(env: &Env, agent: &Address, from: AgentStatus, to: AgentStatus) {
    let topics = (Symbol::new(env, "AgentStatusChanged"), agent.clone());
    env.events().publish(topics, (from, to));
}

pub fn bond_updated(env: &Env, agent: &Address, new_bond: i128) {
    let topics = (Symbol::new(env, "BondUpdated"), agent.clone());
    env.events().publish(topics, new_bond);
}
