use crate::{AgentVault, AgentVaultClient, Params, Vault, VaultError};
use proptest::prelude::*;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _};
use soroban_sdk::token::Client as TokenClient;
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{vec, Address, Env, FromVal, Symbol, Vec};

const MAX_HAIRCUT: u32 = 8_000; // 80%
const MIN_COLLATERAL: i128 = 100;

struct Setup {
    env: Env,
    client: AgentVaultClient<'static>,
    vault: Address,
    token: Address,
    stellar: StellarAssetClient<'static>,
    token_client: TokenClient<'static>,
    operator: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let operator = Address::generate(&env);
    let (token, stellar, token_client) = create_token_contract(&env, &owner);
    let id = env.register(AgentVault, ());
    let client = AgentVaultClient::new(&env, &id);
    client.init(&owner, &operator, &token, &MAX_HAIRCUT, &MIN_COLLATERAL);
    Setup {
        env,
        client,
        vault: id,
        token,
        stellar,
        token_client,
        operator,
    }
}

fn create_token_contract<'a>(
    env: &Env,
    admin: &Address,
) -> (Address, StellarAssetClient<'a>, TokenClient<'a>) {
    let contract_id = env.register_stellar_asset_contract_v2(admin.clone());
    let stellar_asset_client = StellarAssetClient::new(env, &contract_id.address());
    let token_client = TokenClient::new(env, &contract_id.address());
    (contract_id.address(), stellar_asset_client, token_client)
}

fn agent(env: &Env) -> Address {
    Address::generate(env)
}

/// Deposit `amount` collateral into a freshly-created agent vault.
fn fund(s: &Setup, a: &Address, amount: i128) {
    s.stellar.mint(a, &amount);
    s.client.deposit_collateral(a, &amount);
}

/// `env.events().all()` returns only the events of the MOST RECENT top-level
/// invocation — previous call frames' events are gone. Call this immediately
/// after the event-emitting call, before any read/other call.
fn last_event_topic0(env: &Env) -> Symbol {
    let events = env.events().all();
    let event = events.get(events.len() - 1).unwrap();
    Symbol::from_val(env, &event.1.get(0).unwrap())
}

// ── Init ──────────────────────────────────────────────────────────────────────

#[test]
fn test_init_sets_config() {
    let s = setup();
    assert_eq!(
        s.client.get_params(),
        Params {
            max_haircut_bps: MAX_HAIRCUT,
            min_collateral: MIN_COLLATERAL,
        }
    );
    assert_eq!(s.client.get_token(), s.token);
    assert_eq!(s.client.get_operator(), s.operator);
}

#[test]
fn test_init_rejects_bad_params() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let operator = Address::generate(&env);
    let (token, _, _) = create_token_contract(&env, &owner);
    let id = env.register(AgentVault, ());
    let client = AgentVaultClient::new(&env, &id);

    assert_eq!(
        client.try_init(&owner, &operator, &token, &0, &MIN_COLLATERAL),
        Err(Ok(VaultError::InvalidParams))
    );
    assert_eq!(
        client.try_init(&owner, &operator, &token, &10_001, &MIN_COLLATERAL),
        Err(Ok(VaultError::InvalidParams))
    );
    assert_eq!(
        client.try_init(&owner, &operator, &token, &MAX_HAIRCUT, &-1),
        Err(Ok(VaultError::InvalidParams))
    );
}

// ── Collateral ───────────────────────────────────────────────────────────────

#[test]
fn test_deposit_collateral_creates_vault() {
    let s = setup();
    let a = agent(&s.env);
    s.stellar.mint(&a, &1_000);
    s.client.deposit_collateral(&a, &1_000);
    let topic = last_event_topic0(&s.env);

    let vault: Vault = s.client.get_vault(&a);
    assert_eq!(vault.collateral, 1_000);
    assert_eq!(vault.float, 0);
    // Default haircut is the global maximum.
    assert_eq!(vault.haircut_bps, MAX_HAIRCUT);
    assert_eq!(s.token_client.balance(&s.vault), 1_000);
    assert_eq!(topic, Symbol::new(&s.env, "CollateralDeposited"));
}

#[test]
fn test_deposit_rejects_zero() {
    let s = setup();
    let a = agent(&s.env);
    assert_eq!(
        s.client.try_deposit_collateral(&a, &0),
        Err(Ok(VaultError::InvalidAmount))
    );
}

#[test]
fn test_withdraw_more_than_collateral() {
    let s = setup();
    let a = agent(&s.env);
    fund(&s, &a, 100);
    assert_eq!(
        s.client.try_withdraw_collateral(&a, &101),
        Err(Ok(VaultError::InsufficientCollateral))
    );
}

#[test]
fn test_full_exit_when_float_zero() {
    let s = setup();
    let a = agent(&s.env);
    fund(&s, &a, 1_000);
    s.client.withdraw_collateral(&a, &1_000);
    let topic = last_event_topic0(&s.env);

    assert_eq!(s.client.get_vault(&a).collateral, 0);
    assert_eq!(s.token_client.balance(&a), 1_000);
    assert_eq!(topic, Symbol::new(&s.env, "CollateralWithdrawn"));
}

#[test]
fn test_withdraw_keeps_min_collateral_and_solvency() {
    let s = setup();
    let a = agent(&s.env);
    fund(&s, &a, 1_000);
    s.client.mint_float(&a, &800); // full 80% bound

    // Shrinking collateral below the solvency bound is rejected.
    assert_eq!(
        s.client.try_withdraw_collateral(&a, &100),
        Err(Ok(VaultError::SolvencyViolated))
    );
    // Burn first, then withdraw within the new bound.
    s.client.burn_float(&a, &100);
    // float 700 needs collateral >= ceil(700 / 0.8) = 875.
    s.client.withdraw_collateral(&a, &125);
    assert_eq!(s.client.get_vault(&a).collateral, 875);
    assert_eq!(s.client.get_vault(&a).float, 700);
}

#[test]
fn test_withdraw_below_min_collateral_rejected() {
    let s = setup();
    let a = agent(&s.env);
    fund(&s, &a, 200);
    s.client.mint_float(&a, &100);
    assert_eq!(
        s.client.try_withdraw_collateral(&a, &150),
        Err(Ok(VaultError::MinCollateralViolated))
    );
}

// ── Float ────────────────────────────────────────────────────────────────────

#[test]
fn test_mint_float_bounded_by_haircut() {
    let s = setup();
    let a = agent(&s.env);
    fund(&s, &a, 1_000);
    s.client.mint_float(&a, &800);
    let topic = last_event_topic0(&s.env);

    assert_eq!(s.client.get_vault(&a).float, 800);
    assert_eq!(topic, Symbol::new(&s.env, "FloatMinted"));

    assert_eq!(
        s.client.try_mint_float(&a, &1),
        Err(Ok(VaultError::SolvencyViolated))
    );
}

#[test]
fn test_burn_float() {
    let s = setup();
    let a = agent(&s.env);
    fund(&s, &a, 1_000);
    s.client.mint_float(&a, &500);
    s.client.burn_float(&a, &200);
    let topic = last_event_topic0(&s.env);

    assert_eq!(s.client.get_vault(&a).float, 300);
    assert_eq!(topic, Symbol::new(&s.env, "FloatBurned"));

    assert_eq!(
        s.client.try_burn_float(&a, &301),
        Err(Ok(VaultError::InsufficientFloat))
    );
}

#[test]
fn test_transfer_float_atomic() {
    let s = setup();
    let a = agent(&s.env);
    let b = agent(&s.env);
    fund(&s, &a, 1_000);
    fund(&s, &b, 1_000);
    s.client.mint_float(&a, &500);
    s.client.transfer_float(&a, &b, &300);
    let topic = last_event_topic0(&s.env);

    assert_eq!(s.client.get_vault(&a).float, 200);
    assert_eq!(s.client.get_vault(&b).float, 300);
    assert_eq!(topic, Symbol::new(&s.env, "FloatTransferred"));

    assert_eq!(
        s.client.try_transfer_float(&a, &b, &201),
        Err(Ok(VaultError::InsufficientFloat))
    );
}

/// Regression test: transferring float to yourself must be rejected, not
/// silently double-credited. `transfer_float` reads `from`'s and `to`'s
/// vaults into two separate in-memory structs, then writes each back with
/// `write_vault`. When `from == to` both reads observe the same starting
/// balance and the second write clobbers the first, so a naive
/// implementation nets the agent `+amount` float per call with no
/// corresponding mint or collateral movement — an unbounded free-float
/// exploit that also breaks the global solvency invariant.
#[test]
fn test_transfer_float_rejects_self_transfer() {
    let s = setup();
    let a = agent(&s.env);
    fund(&s, &a, 1_000);
    s.client.mint_float(&a, &500);

    assert_eq!(
        s.client.try_transfer_float(&a, &a, &100),
        Err(Ok(VaultError::InvalidParams))
    );
    // Float must be unchanged — no free minting via self-transfer.
    assert_eq!(s.client.get_vault(&a).float, 500);
}

#[test]
fn test_transfer_float_respects_recipient_bound() {
    let s = setup();
    let a = agent(&s.env);
    let b = agent(&s.env);
    fund(&s, &a, 1_000);
    fund(&s, &b, 500); // b bound = 400
    s.client.mint_float(&a, &500);

    assert_eq!(
        s.client.try_transfer_float(&a, &b, &500),
        Err(Ok(VaultError::SolvencyViolated))
    );
    // Partial transfer stays within b's bound.
    s.client.transfer_float(&a, &b, &400);
    assert_eq!(s.client.get_vault(&b).float, 400);
}

#[test]
fn test_transfer_to_agent_atomic() {
    let s = setup();
    let a = agent(&s.env);
    let b = agent(&s.env);
    fund(&s, &a, 1_000);
    fund(&s, &b, 1_000);
    s.client.mint_float(&a, &500);
    s.client.transfer_to_agent(&a, &b, &300);

    assert_eq!(s.client.get_vault(&a).float, 200);
    assert_eq!(s.client.get_vault(&b).float, 300);
}

// ── Settlement ───────────────────────────────────────────────────────────────

#[test]
fn test_settle_net_net_zero() {
    let s = setup();
    let a = agent(&s.env);
    let b = agent(&s.env);
    fund(&s, &a, 1_000);
    fund(&s, &b, 1_000);
    s.client.mint_float(&a, &300);
    s.client.mint_float(&b, &300);

    s.env.ledger().set_timestamp(1_700_000_000);
    let entries: Vec<(Address, i128)> = vec![&s.env, (a.clone(), -100), (b.clone(), 100)];
    s.client.settle_net(&entries);
    let topic = last_event_topic0(&s.env);

    assert_eq!(s.client.get_vault(&a).float, 200);
    assert_eq!(s.client.get_vault(&b).float, 400);
    assert_eq!(s.client.get_vault(&b).last_settled, 1_700_000_000);
    assert_eq!(topic, Symbol::new(&s.env, "VaultSettled"));
}

#[test]
fn test_settle_net_rejects_nonzero_sum() {
    let s = setup();
    let a = agent(&s.env);
    let b = agent(&s.env);
    fund(&s, &a, 1_000);
    fund(&s, &b, 1_000);

    let entries: Vec<(Address, i128)> = vec![&s.env, (a, 100), (b, 50)];
    assert_eq!(
        s.client.try_settle_net(&entries),
        Err(Ok(VaultError::NetNotZero))
    );
}

#[test]
fn test_settle_net_rejects_insufficient_float() {
    let s = setup();
    let a = agent(&s.env);
    let b = agent(&s.env);
    fund(&s, &a, 1_000);
    fund(&s, &b, 1_000);
    s.client.mint_float(&b, &300);

    // a has the cap to absorb +400; b would go to -100.
    let entries: Vec<(Address, i128)> = vec![&s.env, (a, 400), (b, -400)];
    assert_eq!(
        s.client.try_settle_net(&entries),
        Err(Ok(VaultError::InsufficientFloat))
    );
}

#[test]
fn test_settle_net_rejects_solvency_breach() {
    let s = setup();
    let a = agent(&s.env);
    let b = agent(&s.env);
    fund(&s, &a, 1_000);
    fund(&s, &b, 1_000);
    s.client.mint_float(&b, &800); // b at full bound

    // a's first entry would exceed its 800 cap.
    let entries: Vec<(Address, i128)> = vec![&s.env, (a.clone(), 900), (b, -900)];
    assert_eq!(
        s.client.try_settle_net(&entries),
        Err(Ok(VaultError::SolvencyViolated))
    );
}

#[test]
fn test_settle_net_batch_cap() {
    let s = setup();
    let mut entries: Vec<(Address, i128)> = Vec::new(&s.env);
    for _ in 0..101 {
        let a = agent(&s.env);
        entries.push_back((a, 0));
    }
    assert_eq!(
        s.client.try_settle_net(&entries),
        Err(Ok(VaultError::BatchTooLarge))
    );
}

// ── Haircut ──────────────────────────────────────────────────────────────────

#[test]
fn test_set_haircut_enforces_max_and_solvency() {
    let s = setup();
    let a = agent(&s.env);
    fund(&s, &a, 1_000);
    s.client.mint_float(&a, &800); // at 80% bound

    // Lowering below the outstanding float breaks solvency.
    assert_eq!(
        s.client.try_set_haircut(&a, &7_000),
        Err(Ok(VaultError::SolvencyViolated))
    );
    // Above the global maximum is rejected outright.
    assert_eq!(
        s.client.try_set_haircut(&a, &8_001),
        Err(Ok(VaultError::InvalidHaircut))
    );
    assert_eq!(
        s.client.try_set_haircut(&a, &0),
        Err(Ok(VaultError::InvalidHaircut))
    );
    // A valid change: burn float first so a lower haircut stays solvent.
    s.client.burn_float(&a, &100); // float 700
    s.client.set_haircut(&a, &7_000); // cap 700 >= float 700
    let topic = last_event_topic0(&s.env);
    assert_eq!(s.client.get_vault(&a).haircut_bps, 7_000);
    assert_eq!(topic, Symbol::new(&s.env, "HaircutUpdated"));
}

#[test]
fn test_set_haircut_lower_ok_after_burn() {
    let s = setup();
    let a = agent(&s.env);
    fund(&s, &a, 1_000);
    s.client.mint_float(&a, &600);
    s.client.set_haircut(&a, &7_000); // cap 700 >= float 600
    assert_eq!(s.client.get_vault(&a).haircut_bps, 7_000);
}

// ── Auth ─────────────────────────────────────────────────────────────────────

#[test]
#[should_panic]
fn test_mint_float_requires_operator() {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let operator = Address::generate(&env);
    let (token, stellar, _) = create_token_contract(&env, &owner);
    let id = env.register(AgentVault, ());
    let client = AgentVaultClient::new(&env, &id);
    client.init(&owner, &operator, &token, &MAX_HAIRCUT, &MIN_COLLATERAL);

    let a = agent(&env);
    stellar.mint(&a, &1_000);
    client.deposit_collateral(&a, &1_000);

    // Drop all auths: an unauthorised caller must not be able to mint.
    env.mock_auths(&[]);
    client.mint_float(&a, &100);
}

// ── Invariant checks ────────────────────────────────────────────────────────

#[test]
fn test_check_invariant_holds_for_solvent_vault() {
    let s = setup();
    let a = agent(&s.env);
    fund(&s, &a, 1_000);
    s.client.mint_float(&a, &500); // well within 80% bound

    let (holds, float, max_allowed) = s.client.check_invariant(&a);
    assert!(holds);
    assert_eq!(float, 500);
    assert_eq!(max_allowed, 800);
}

#[test]
fn test_check_invariant_holds_for_empty_vault() {
    let s = setup();
    let a = agent(&s.env);
    fund(&s, &a, 1_000);

    let (holds, float, max_allowed) = s.client.check_invariant(&a);
    assert!(holds);
    assert_eq!(float, 0);
    assert_eq!(max_allowed, 800);
}

#[test]
fn test_check_invariant_holds_at_boundary() {
    let s = setup();
    let a = agent(&s.env);
    fund(&s, &a, 1_000);
    s.client.mint_float(&a, &800); // exactly at 80% bound

    let (holds, float, max_allowed) = s.client.check_invariant(&a);
    assert!(holds);
    assert_eq!(float, 800);
    assert_eq!(max_allowed, 800);
}

#[test]
fn test_check_invariants_batch() {
    let s = setup();
    let a = agent(&s.env);
    let b = agent(&s.env);
    fund(&s, &a, 1_000);
    fund(&s, &b, 500);
    s.client.mint_float(&a, &500);
    s.client.mint_float(&b, &400);

    let agents: Vec<Address> = vec![&s.env, a.clone(), b.clone()];
    let results = s.client.check_invariants(&agents);
    assert_eq!(results.len(), 2);
    assert!(results.get(0).unwrap().1); // a holds
    assert!(results.get(1).unwrap().1); // b holds
}

// ── Property tests ───────────────────────────────────────────────────────────

proptest! {
    #[test]
    fn proptest_max_float_bounded(
        collateral in 0i128..10_000_000,
        haircut in 0u32..=10_000,
    ) {
        let max = AgentVault::max_float_of(collateral, haircut);
        prop_assert!(max <= collateral, "float cap {max} exceeds collateral {collateral}");
        prop_assert!(max >= 0);
        if haircut == 10_000 {
            prop_assert_eq!(max, collateral);
        }
        if haircut == 0 {
            prop_assert_eq!(max, 0);
        }
    }

    #[test]
    fn proptest_max_float_monotonic_in_collateral(
        collateral in 0i128..10_000_000,
        delta in 0i128..1_000_000,
        haircut in 0u32..=10_000,
    ) {
        let low = AgentVault::max_float_of(collateral, haircut);
        let high = AgentVault::max_float_of(collateral + delta, haircut);
        prop_assert!(high >= low, "adding collateral shrank the float cap");
    }
}

// ── Issue #513: checked arithmetic on the three debits ────────────────────
// Each of the three functions below previously guarded its debit with an
// explicit `amount > balance` comparison and then subtracted unchecked. The
// guard is now the arithmetic itself (`checked_sub`), so these tests pin the
// rejected-underflow behaviour *and* that a rejection leaves no partial state
// behind. `withdraw_collateral` additionally has to release its reentrancy
// lock on that path: `acquire_lock` panics when the lock is still held, so the
// follow-up call in the first test fails loudly if the release is dropped.

#[test]
fn test_withdraw_collateral_underflow_rejected_and_state_unchanged() {
    let s = setup();
    let a = agent(&s.env);
    fund(&s, &a, 1_000);
    s.client.mint_float(&a, &100);

    assert_eq!(
        s.client.try_withdraw_collateral(&a, &1_001),
        Err(Ok(VaultError::InsufficientCollateral))
    );

    let vault: Vault = s.client.get_vault(&a);
    assert_eq!(vault.collateral, 1_000);
    assert_eq!(vault.float, 100);
    assert_eq!(s.token_client.balance(&s.vault), 1_000);

    // The rejected call must have released the reentrancy lock, otherwise
    // this second withdrawal panics inside `acquire_lock`.
    s.client.withdraw_collateral(&a, &500);
    assert_eq!(s.client.get_vault(&a).collateral, 500);
    assert_eq!(s.token_client.balance(&a), 500);
}

#[test]
fn test_burn_float_underflow_rejected_and_state_unchanged() {
    let s = setup();
    let a = agent(&s.env);
    fund(&s, &a, 1_000);
    s.client.mint_float(&a, &500);

    assert_eq!(
        s.client.try_burn_float(&a, &501),
        Err(Ok(VaultError::InsufficientFloat))
    );
    assert_eq!(s.client.get_vault(&a).float, 500);

    // Burning exactly the remaining balance still works after the rejection.
    s.client.burn_float(&a, &500);
    assert_eq!(s.client.get_vault(&a).float, 0);
}

#[test]
fn test_transfer_float_underflow_rejected_and_both_sides_unchanged() {
    let s = setup();
    let a = agent(&s.env);
    let b = agent(&s.env);
    fund(&s, &a, 1_000);
    fund(&s, &b, 1_000);
    s.client.mint_float(&a, &500);
    s.client.mint_float(&b, &200);

    assert_eq!(
        s.client.try_transfer_float(&a, &b, &501),
        Err(Ok(VaultError::InsufficientFloat))
    );

    assert_eq!(s.client.get_vault(&a).float, 500);
    assert_eq!(s.client.get_vault(&b).float, 200);

    // The rejected debit must not have been credited to the recipient.
    s.client.transfer_float(&a, &b, &500);
    assert_eq!(s.client.get_vault(&a).float, 0);
    assert_eq!(s.client.get_vault(&b).float, 700);
}

// ── Upgrade path (#500) ───────────────────────────────────────────────────────

mod upgrade {
    use super::*;
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::{BytesN, IntoVal};

    fn hash(env: &Env) -> BytesN<32> {
        BytesN::from_array(env, &[7u8; 32])
    }

    #[test]
    fn version_starts_at_one() {
        let s = setup();
        assert_eq!(s.client.version(), 1);
    }

    #[test]
    fn version_reads_as_one_for_a_vault_deployed_before_versioning() {
        let s = setup();
        s.env.as_contract(&s.vault, || {
            s.env.storage().instance().remove(&crate::DataKey::Version);
        });
        assert_eq!(s.client.version(), 1);
    }

    #[test]
    fn upgrade_fails_without_owner_auth() {
        let s = setup();
        s.env.mock_auths(&[]);

        assert!(s.client.try_upgrade(&hash(&s.env)).is_err());
        assert_eq!(s.client.version(), 1);
    }

    #[test]
    fn the_operator_cannot_upgrade() {
        let s = setup();
        let new_hash = hash(&s.env);
        s.env.mock_auths(&[MockAuth {
            address: &s.operator,
            invoke: &MockAuthInvoke {
                contract: &s.vault,
                fn_name: "upgrade",
                args: (new_hash.clone(),).into_val(&s.env),
                sub_invokes: &[],
            },
        }]);

        assert!(s.client.try_upgrade(&new_hash).is_err());
        assert_eq!(s.client.version(), 1);
    }

    #[test]
    fn an_arbitrary_address_cannot_upgrade() {
        let s = setup();
        let stranger = agent(&s.env);
        let new_hash = hash(&s.env);
        s.env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &s.vault,
                fn_name: "upgrade",
                args: (new_hash.clone(),).into_val(&s.env),
                sub_invokes: &[],
            },
        }]);

        assert!(s.client.try_upgrade(&new_hash).is_err());
    }

    #[test]
    fn upgrade_before_init_reports_not_initialized() {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(AgentVault, ());
        let client = AgentVaultClient::new(&env, &id);

        assert_eq!(
            client.try_upgrade(&hash(&env)),
            Err(Ok(VaultError::NotInitialized))
        );
    }

    #[test]
    fn recording_an_upgrade_bumps_the_version_and_emits_the_audit_event() {
        let s = setup();

        let (old, new) = s
            .env
            .as_contract(&s.vault, || AgentVault::record_upgrade(&s.env));

        // Events are only visible from the invocation that emitted them, so read
        // them before making any other call.
        let events = s.env.events().all();
        let event = events.get(events.len() - 1).unwrap();
        assert_eq!(event.0, s.vault);
        assert_eq!(
            Symbol::from_val(&s.env, &event.1.get(0).unwrap()),
            Symbol::new(&s.env, "ContractUpgraded")
        );
        let (old_v, new_v): (u32, u32) = FromVal::from_val(&s.env, &event.2);
        assert_eq!((old_v, new_v), (1, 2));

        assert_eq!((old, new), (1, 2));
        assert_eq!(s.client.version(), 2);
    }

    #[test]
    fn each_recorded_upgrade_increments_the_version_by_one() {
        let s = setup();
        for expected in 2..=5u32 {
            let (_, new) = s
                .env
                .as_contract(&s.vault, || AgentVault::record_upgrade(&s.env));
            assert_eq!(new, expected);
        }
        assert_eq!(s.client.version(), 5);
    }

    #[test]
    fn a_failed_upgrade_leaves_version_and_balances_untouched() {
        let s = setup();
        let a = agent(&s.env);
        fund(&s, &a, 1_000);
        s.client.mint_float(&a, &100);

        // Un-uploaded wasm: the code swap fails and the whole call rolls back.
        assert!(s.client.try_upgrade(&hash(&s.env)).is_err());

        assert_eq!(s.client.version(), 1);
        let vault = s.client.get_vault(&a);
        assert_eq!((vault.collateral, vault.float), (1_000, 100));
    }
}
