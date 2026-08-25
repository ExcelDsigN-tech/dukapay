use soroban_sdk::{Address, Env, Symbol};

pub fn collateral_deposited(env: &Env, agent: &Address, amount: i128, new_collateral: i128) {
    let topics = (Symbol::new(env, "CollateralDeposited"), agent.clone());
    env.events().publish(topics, (amount, new_collateral));
}

pub fn collateral_withdrawn(env: &Env, agent: &Address, amount: i128, new_collateral: i128) {
    let topics = (Symbol::new(env, "CollateralWithdrawn"), agent.clone());
    env.events().publish(topics, (amount, new_collateral));
}

pub fn float_minted(env: &Env, agent: &Address, amount: i128, new_float: i128) {
    let topics = (Symbol::new(env, "FloatMinted"), agent.clone());
    env.events().publish(topics, (amount, new_float));
}

pub fn float_burned(env: &Env, agent: &Address, amount: i128, new_float: i128) {
    let topics = (Symbol::new(env, "FloatBurned"), agent.clone());
    env.events().publish(topics, (amount, new_float));
}

pub fn float_transferred(env: &Env, from: &Address, to: &Address, amount: i128) {
    let topics = (
        Symbol::new(env, "FloatTransferred"),
        from.clone(),
        to.clone(),
    );
    env.events().publish(topics, amount);
}

pub fn vault_settled(env: &Env, agent: &Address, delta: i128, new_float: i128) {
    let topics = (Symbol::new(env, "VaultSettled"), agent.clone());
    env.events().publish(topics, (delta, new_float));
}

pub fn haircut_updated(env: &Env, agent: &Address, old: u32, new: u32) {
    let topics = (Symbol::new(env, "HaircutUpdated"), agent.clone());
    env.events().publish(topics, (old, new));
}

pub fn vault_circuit_breaker_set(env: &Env, breaker: Option<Address>) {
    let topics = (Symbol::new(env, "VaultCircuitBreakerSet"),);
    env.events().publish(topics, breaker);
}
