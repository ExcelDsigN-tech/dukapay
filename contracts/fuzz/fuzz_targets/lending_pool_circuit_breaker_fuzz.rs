#![no_main]

// Fuzz target for #492/#493/#494: prove that the value-moving and
// state-mutating entry points on `LendingPool` can never execute while the
// DukaPay `CircuitBreaker` is tripped (global, contract-wide, or function-level
// pause). A bypass here is a critical invariant violation — the breaker exists
// to halt fund movement during an incident response.

use arbitrary::Arbitrary;
use circuit_breaker::{CircuitBreaker, CircuitBreakerClient};
use lending_pool::{LendingPool, LendingPoolClient, PoolError};
use libfuzzer_sys::fuzz_target;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, Env, Symbol, Vec};

#[derive(Arbitrary, Debug)]
enum FuzzAction {
    EmergencyWithdrawWhilePaused { pause_scope: u8, amount: i128 },
    EmergencyWithdrawWhileUnpaused { amount: i128 },
    WithdrawWhilePaused { pause_scope: u8, amount: i128 },
    WithdrawWhileUnpaused { amount: i128 },
    AdjustOutstandingWhilePaused { pause_scope: u8, delta: i128 },
    AdjustOutstandingWhileUnpaused { delta: i128 },
}

fn trip_pause(
    breaker_client: &CircuitBreakerClient,
    signer: &Address,
    pool_id: &Address,
    scope: u8,
    function: Symbol,
) {
    match scope % 3 {
        0 => breaker_client.pause_all(signer),
        1 => breaker_client.pause_contract(signer, pool_id),
        _ => breaker_client.pause_function(signer, pool_id, &function),
    }
}

fn setup<'a>(
    env: &Env,
) -> (
    Address,
    Address,
    Address,
    StellarAssetClient<'a>,
    LendingPoolClient<'a>,
    CircuitBreakerClient<'a>,
    Address,
    Address,
) {
    let token_admin = Address::generate(env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    let stellar_asset_client = StellarAssetClient::new(env, &token_id);

    let pool_id = env.register(LendingPool, ());
    let pool_client = LendingPoolClient::new(env, &pool_id);
    pool_client.initialize(&token_admin);
    pool_client.set_withdrawal_cooldown(&0);

    let signer = Address::generate(env);
    let mut signers = Vec::new(env);
    signers.push_back(signer.clone());
    signers.push_back(Address::generate(env));
    signers.push_back(Address::generate(env));
    let breaker_id = env.register(CircuitBreaker, ());
    let breaker_client = CircuitBreakerClient::new(env, &breaker_id);
    breaker_client.initialize(&token_admin, &signers, &1, &3_600);
    pool_client.set_circuit_breaker(&Some(breaker_id));

    let provider = Address::generate(env);
    stellar_asset_client.mint(&provider, &10_000_000);
    pool_client.deposit(&provider, &token_id, &10_000_000, &0);

    (
        token_admin,
        token_id,
        pool_id,
        stellar_asset_client,
        pool_client,
        breaker_client,
        provider,
        signer,
    )
}

fuzz_target!(|action: FuzzAction| {
    let env = Env::default();
    env.mock_all_auths();

    let (_token_admin, token_id, pool_id, _stellar, pool_client, breaker_client, provider, signer) =
        setup(&env);

    match action {
        FuzzAction::EmergencyWithdrawWhilePaused {
            pause_scope,
            amount,
        } => {
            trip_pause(
                &breaker_client,
                &signer,
                &pool_id,
                pause_scope,
                Symbol::new(&env, "withdraw"),
            );
            let result = pool_client.try_emergency_withdraw(&provider, &token_id, &amount, &0);
            assert_eq!(
                result,
                Err(Ok(PoolError::CircuitBreakerTripped)),
                "emergency_withdraw executed while the circuit breaker was tripped"
            );
        }
        FuzzAction::EmergencyWithdrawWhileUnpaused { amount } => {
            let result = pool_client.try_emergency_withdraw(&provider, &token_id, &amount, &0);
            assert!(
                result != Err(Ok(PoolError::CircuitBreakerTripped)),
                "emergency_withdraw spuriously blocked with no active pause"
            );
        }
        FuzzAction::WithdrawWhilePaused {
            pause_scope,
            amount,
        } => {
            trip_pause(
                &breaker_client,
                &signer,
                &pool_id,
                pause_scope,
                Symbol::new(&env, "withdraw"),
            );
            let result = pool_client.try_withdraw(&provider, &token_id, &amount, &0);
            assert_eq!(
                result,
                Err(Ok(PoolError::CircuitBreakerTripped)),
                "withdraw executed while the circuit breaker was tripped"
            );
        }
        FuzzAction::WithdrawWhileUnpaused { amount } => {
            let result = pool_client.try_withdraw(&provider, &token_id, &amount, &0);
            assert!(
                result != Err(Ok(PoolError::CircuitBreakerTripped)),
                "withdraw spuriously blocked with no active pause"
            );
        }
        FuzzAction::AdjustOutstandingWhilePaused { pause_scope, delta } => {
            trip_pause(
                &breaker_client,
                &signer,
                &pool_id,
                pause_scope,
                Symbol::new(&env, "adjust_outstanding"),
            );
            let result = pool_client.try_adjust_outstanding(&token_id, &delta);
            assert_eq!(
                result,
                Err(Ok(PoolError::CircuitBreakerTripped)),
                "adjust_outstanding executed while the circuit breaker was tripped"
            );
        }
        FuzzAction::AdjustOutstandingWhileUnpaused { delta } => {
            let result = pool_client.try_adjust_outstanding(&token_id, &delta);
            assert!(
                result != Err(Ok(PoolError::CircuitBreakerTripped)),
                "adjust_outstanding spuriously blocked with no active pause"
            );
        }
    }
});
