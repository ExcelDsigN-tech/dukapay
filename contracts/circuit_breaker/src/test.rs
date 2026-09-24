#[cfg(test)]
mod test {
    use crate::{
        CircuitBreaker, CircuitBreakerClient, CircuitBreakerError, OverrideTarget,
        PAUSE_DURATION_SECONDS,
    };
    use soroban_sdk::testutils::{Address as _, Ledger as _};
    use soroban_sdk::{Address, Env, Symbol, Vec};

    fn setup() -> (Env, Address, Address, Vec<Address>) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);
        let s3 = Address::generate(&env);
        let s4 = Address::generate(&env);
        let s5 = Address::generate(&env);
        let mut signers = Vec::new(&env);
        signers.push_back(s1);
        signers.push_back(s2);
        signers.push_back(s3);
        signers.push_back(s4);
        signers.push_back(s5);
        let contract_id = env.register(CircuitBreaker, ());
        let client = CircuitBreakerClient::new(&env, &contract_id);
        client.initialize(&admin, &signers, &3, &86_400);
        (env, contract_id, admin, signers)
    }

    #[test]
    fn init_stores_config() {
        let (_env, contract_id, _admin, signers) = setup();
        let client = CircuitBreakerClient::new(&_env, &contract_id);
        assert_eq!(client.get_threshold(), 3);
        assert_eq!(client.get_override_timelock(), 86_400);
        assert_eq!(client.get_signers(), signers);
        assert!(!client.is_globally_paused());
    }

    #[test]
    #[should_panic(expected = "#5001")]
    fn double_init_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let s1 = Address::generate(&env);
        let mut signers = Vec::new(&env);
        signers.push_back(s1);
        let contract_id = env.register(CircuitBreaker, ());
        let client = CircuitBreakerClient::new(&env, &contract_id);
        client.initialize(&admin, &signers, &1, &3_600);
        client.initialize(&admin, &signers, &1, &3_600);
    }

    #[test]
    #[should_panic(expected = "#5008")]
    fn duplicate_signer_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let s1 = Address::generate(&env);
        let mut signers = Vec::new(&env);
        signers.push_back(s1.clone());
        signers.push_back(s1);
        let contract_id = env.register(CircuitBreaker, ());
        let client = CircuitBreakerClient::new(&env, &contract_id);
        client.initialize(&admin, &signers, &1, &3_600);
    }

    #[test]
    #[should_panic(expected = "#5004")]
    fn non_signer_cannot_pause() {
        let (_env, contract_id, _admin, _signers) = setup();
        let client = CircuitBreakerClient::new(&_env, &contract_id);
        let stranger = Address::generate(&_env);
        let target = Address::generate(&_env);
        client.pause_contract(&stranger, &target);
    }

    #[test]
    fn global_pause_blocks_then_expires() {
        let (env, contract_id, _admin, signers) = setup();
        let client = CircuitBreakerClient::new(&env, &contract_id);
        client.pause_all(&signers.get(0).unwrap());
        assert!(client.is_globally_paused());
        let target = Address::generate(&env);
        assert!(client.is_blocked(&target, &Symbol::new(&env, "deposit")));

        // Advance past 72h auto-expiry.
        env.ledger().set_timestamp(PAUSE_DURATION_SECONDS + 1);
        assert!(!client.is_globally_paused());
        assert!(!client.is_blocked(&target, &Symbol::new(&env, "deposit")));
    }

    #[test]
    fn contract_pause_is_independent_of_function_pause() {
        let (env, contract_id, _admin, signers) = setup();
        let client = CircuitBreakerClient::new(&env, &contract_id);
        let target = Address::generate(&env);
        client.pause_function(
            &signers.get(0).unwrap(),
            &target,
            &Symbol::new(&env, "withdraw"),
        );
        assert!(client.is_function_paused(&target, &Symbol::new(&env, "withdraw")));
        assert!(!client.is_contract_paused(&target));
        assert!(client.is_blocked(&target, &Symbol::new(&env, "withdraw")));
        // A different function is not blocked.
        assert!(!client.is_blocked(&target, &Symbol::new(&env, "deposit")));
    }

    #[test]
    fn contract_wildcard_pause_blocks_all_functions() {
        let (env, contract_id, _admin, signers) = setup();
        let client = CircuitBreakerClient::new(&env, &contract_id);
        let target = Address::generate(&env);
        client.pause_contract(&signers.get(0).unwrap(), &target);
        assert!(client.is_contract_paused(&target));
        assert!(client.is_blocked(&target, &Symbol::new(&env, "deposit")));
        assert!(client.is_blocked(&target, &Symbol::new(&env, "withdraw")));
    }

    #[test]
    fn override_lifts_global_pause_after_timelock_and_quorum() {
        let (env, contract_id, _admin, signers) = setup();
        let client = CircuitBreakerClient::new(&env, &contract_id);
        client.pause_all(&signers.get(0).unwrap());
        let id = client.propose_override(&signers.get(1).unwrap(), &OverrideTarget::Global);

        // Not enough approvals yet.
        client.approve_override(&signers.get(1).unwrap(), &id);
        client.approve_override(&signers.get(2).unwrap(), &id);
        // Timelock not elapsed.
        assert_eq!(
            client.try_execute_override(&Address::generate(&env), &id),
            Err(Ok(CircuitBreakerError::TimelockNotElapsed))
        );

        // Advance past the override timelock (24h) but still within pause window.
        env.ledger().set_timestamp(86_400 + 1);

        // Third approval reaches the 3-of-5 threshold.
        client.approve_override(&signers.get(3).unwrap(), &id);
        client.execute_override(&Address::generate(&env), &id);

        assert!(!client.is_globally_paused());
    }

    #[test]
    fn override_requires_quorum() {
        let (env, contract_id, _admin, signers) = setup();
        let client = CircuitBreakerClient::new(&env, &contract_id);
        let target = Address::generate(&env);
        client.pause_contract(&signers.get(0).unwrap(), &target);
        let id = client.propose_override(
            &signers.get(1).unwrap(),
            &OverrideTarget::Contract(target.clone()),
        );

        env.ledger().set_timestamp(86_400 + 1);
        client.approve_override(&signers.get(1).unwrap(), &id);
        client.approve_override(&signers.get(2).unwrap(), &id);
        assert_eq!(
            client.try_execute_override(&Address::generate(&env), &id),
            Err(Ok(CircuitBreakerError::ThresholdNotMet))
        );
        assert!(client.is_contract_paused(&target));
    }

    #[test]
    fn admin_can_cancel_override() {
        let (env, contract_id, admin, signers) = setup();
        let client = CircuitBreakerClient::new(&env, &contract_id);
        client.pause_all(&signers.get(0).unwrap());
        let id = client.propose_override(&signers.get(1).unwrap(), &OverrideTarget::Global);
        client.cancel_override(&admin, &id);
        env.ledger().set_timestamp(86_400 + 1);
        // A cancelled proposal can no longer be executed.
        assert_eq!(
            client.try_execute_override(&Address::generate(&env), &id),
            Err(Ok(CircuitBreakerError::ProposalNotActive))
        );
        assert!(client.is_globally_paused());
    }

    #[test]
    fn expired_override_cannot_execute() {
        let (env, contract_id, _admin, signers) = setup();
        let client = CircuitBreakerClient::new(&env, &contract_id);
        client.pause_all(&signers.get(0).unwrap());
        let id = client.propose_override(&signers.get(1).unwrap(), &OverrideTarget::Global);
        // Advance beyond pause window + override timelock so the proposal is stale.
        env.ledger()
            .set_timestamp(PAUSE_DURATION_SECONDS + 86_400 + 1);
        client.approve_override(&signers.get(1).unwrap(), &id);
        client.approve_override(&signers.get(2).unwrap(), &id);
        client.approve_override(&signers.get(3).unwrap(), &id);
        assert_eq!(
            client.try_execute_override(&Address::generate(&env), &id),
            Err(Ok(CircuitBreakerError::ProposalExpired))
        );
    }

    #[test]
    fn function_override_lifts_only_that_function() {
        let (env, contract_id, _admin, signers) = setup();
        let client = CircuitBreakerClient::new(&env, &contract_id);
        let target = Address::generate(&env);
        let dep = Symbol::new(&env, "deposit");
        let wit = Symbol::new(&env, "withdraw");
        client.pause_function(&signers.get(0).unwrap(), &target, &dep.clone());
        client.pause_function(&signers.get(0).unwrap(), &target, &wit.clone());
        let id = client.propose_override(
            &signers.get(1).unwrap(),
            &OverrideTarget::Function(target.clone(), dep.clone()),
        );
        env.ledger().set_timestamp(86_400 + 1);
        client.approve_override(&signers.get(1).unwrap(), &id);
        client.approve_override(&signers.get(2).unwrap(), &id);
        client.approve_override(&signers.get(3).unwrap(), &id);
        client.execute_override(&Address::generate(&env), &id);

        assert!(!client.is_function_paused(&target, &dep));
        // The other paused function remains blocked.
        assert!(client.is_function_paused(&target, &wit));
    }
}
