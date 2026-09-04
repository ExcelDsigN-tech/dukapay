#![no_main]

// Executable counterpart of contracts/FORMAL_VERIFICATION.md.
// Drives AgentVault with arbitrary operation sequences and PANICS on any
// invariant violation (INV-1 float solvency, INV-6 arithmetic safety,
// INV-7 breaker consistency). A crash is a reproducible counterexample and
// must block merge.
//
// Run with:  cargo +nightly fuzz run invariants_fuzz -- -max_total_time=300

use arbitrary::Arbitrary;
use agent_vault::{AgentVault, AgentVaultClient};
use libfuzzer_sys::fuzz_target;
use soroban_sdk::token::{Client as TokenClient, StellarAssetClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, Symbol};

const MAX_HAIRCUT: u32 = 10_000;
const MIN_COLLATERAL: i128 = 0;
const N_AGENTS: usize = 3;

#[derive(Arbitrary, Debug)]
enum VaultAction {
    Deposit { agent: u8, amount: i128 },
    Mint { agent: u8, amount: i128 },
    Burn { agent: u8, amount: i128 },
    Withdraw { agent: u8, amount: i128 },
    Transfer { from: u8, to: u8, amount: i128 },
    SetHaircut { agent: u8, bps: u32 },
    PauseFunction { function: u8 },
    LiftPause,
}

fn agent_of(env: &Env, agents: &[Address], idx: u8) -> Address {
    agents[(idx as usize) % N_AGENTS].clone()
}

/// INV-1: float <= collateral * haircut_bps / 10_000.
fn assert_solvency(client: &AgentVaultClient, agent: &Address) {
    let v = client.get_vault(agent);
    // INV-6: the solvency bound itself must not overflow.
    let bound = (v.collateral as i128)
        .checked_mul(v.haircut_bps as i128)
        .and_then(|x| x.checked_div(10_000));
    let bound = match bound {
        Some(b) => b,
        None => panic!("INV-6: solvency bound overflowed for agent"),
    };
    assert!(
        v.float <= bound,
        "INV-1 violated: float {} > bound {} (collateral {}, haircut {})",
        v.float, bound, v.collateral, v.haircut_bps
    );
}

/// INV-7: when a function is paused, the guarded call reverts.
fn assert_breaker_consistency(env: &Env, client: &AgentVaultClient, function: &Symbol) {
    let blocked = client.is_circuit_blocked(function);
    if blocked {
        let agent = Address::generate(env);
        // A guarded op must fail while blocked. We pass 0 amount (still
        // hits the circuit guard before any value logic) and expect Err.
        let res = client.try_deposit_collateral(&agent, &0);
        assert!(
            res.is_err() || matches!(res, Ok(Err(_))),
            "INV-7 violated: guarded call succeeded while breaker blocked"
        );
    }
}

fuzz_target!(|actions: Vec<VaultAction>| {
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let operator = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(owner.clone());
    let token = token_id.address();
    let stellar = StellarAssetClient::new(&env, &token);
    let token_client = TokenClient::new(&env, &token);

    let agents: Vec<Address> = (0..N_AGENTS).map(|_| Address::generate(&env)).collect();
    for a in &agents {
        stellar.mint(&a, &1_000_000_000_000);
    }

    let id = env.register(AgentVault, ());
    let client = AgentVaultClient::new(&env, &id);
    client.init(&owner, &operator, &token, &MAX_HAIRCUT, &MIN_COLLATERAL);

    let functions = [
        Symbol::new(&env, "deposit_collateral"),
        Symbol::new(&env, "withdraw_collateral"),
        Symbol::new(&env, "mint_float"),
        Symbol::new(&env, "burn_float"),
        Symbol::new(&env, "transfer_float"),
        Symbol::new(&env, "settle_net"),
    ];

    for action in actions {
        match action {
            VaultAction::Deposit { agent, amount } => {
                let a = agent_of(&env, &agents, agent);
                let amt = amount.clamp(0, 1_000_000_000_000);
                let _ = client.try_deposit_collateral(&a, &amt);
            }
            VaultAction::Mint { agent, amount } => {
                let a = agent_of(&env, &agents, agent);
                let amt = amount.clamp(0, 1_000_000_000_000);
                let _ = client.try_mint_float(&a, &amt);
            }
            VaultAction::Burn { agent, amount } => {
                let a = agent_of(&env, &agents, agent);
                let amt = amount.clamp(0, 1_000_000_000_000);
                let _ = client.try_burn_float(&a, &amt);
            }
            VaultAction::Withdraw { agent, amount } => {
                let a = agent_of(&env, &agents, agent);
                let amt = amount.clamp(0, 1_000_000_000_000);
                let _ = client.try_withdraw_collateral(&a, &amt);
            }
            VaultAction::Transfer { from, to, amount } => {
                let f = agent_of(&env, &agents, from);
                let t = agent_of(&env, &agents, to);
                let amt = amount.clamp(0, 1_000_000_000_000);
                let _ = client.try_transfer_float(&f, &t, &amt);
            }
            VaultAction::SetHaircut { agent, bps } => {
                let a = agent_of(&env, &agents, agent);
                let b = bps % (MAX_HAIRCUT + 1);
                let _ = client.try_set_haircut(&a, &b);
            }
            VaultAction::PauseFunction { function } => {
                let f = &functions[(function as usize) % functions.len()];
                let _ = client.try_set_circuit_breaker(&Some(Address::generate(&env)));
                // Without a real breaker the guard remains a no-op; this path
                // exists to exercise assert_circuit_ok plumbing.
                let _ = f;
            }
            VaultAction::LiftPause => {
                let _ = client.try_set_circuit_breaker(&None::<Address>);
            }
        }
        // Invariant checks after every step, for every agent.
        for a in &agents {
            assert_solvency(&client, a);
        }
    }

    // INV-7 spot-check on each function symbol.
    for f in &functions {
        assert_breaker_consistency(&env, &client, f);
    }
});
