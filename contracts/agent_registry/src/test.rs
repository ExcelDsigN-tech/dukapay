use crate::{AgentRegistry, AgentRegistryClient, AgentStatus, RegistryError};
use soroban_sdk::testutils::{Address as _, Events as _};
use soroban_sdk::{Address, BytesN, Env, FromVal, IntoVal, Symbol};

fn setup() -> (Env, AgentRegistryClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let operator = Address::generate(&env);
    let id = env.register(AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    client.init(&owner, &operator);
    (env, client, owner, operator)
}

fn agent(env: &Env) -> Address {
    Address::generate(env)
}

fn kycs(env: &Env) -> Symbol {
    Symbol::new(env, "kyc_001")
}

fn region(env: &Env) -> Symbol {
    Symbol::new(env, "Nairobi")
}

fn last_event_topic0(env: &Env) -> Symbol {
    let events = env.events().all();
    let event = events.get(events.len() - 1).unwrap();
    Symbol::from_val(env, &event.1.get(0).unwrap())
}

#[test]
fn test_register_creates_pending_agent() {
    let (env, client, _owner, _op) = setup();
    let a = agent(&env);
    client.register(&a, &kycs(&env), &region(&env), &100, &1_000_000);
    let topic = last_event_topic0(&env);

    let info = client.get_agent(&a);
    assert_eq!(info.status, AgentStatus::Pending);
    assert_eq!(info.bond_amount, 100);
    assert_eq!(info.reputation, 0);
    assert_eq!(topic, Symbol::new(&env, "AgentRegistered"));
}

#[test]
fn test_register_rejects_zero_bond() {
    let (env, client, _owner, _op) = setup();
    let a = agent(&env);
    let res = client.try_register(&a, &kycs(&env), &region(&env), &0, &1_000_000);
    assert_eq!(res, Err(Ok(RegistryError::InvalidBond)));
}

#[test]
fn test_register_rejects_duplicate() {
    let (env, client, _owner, _op) = setup();
    let a = agent(&env);
    client.register(&a, &kycs(&env), &region(&env), &100, &1_000_000);
    let res = client.try_register(&a, &kycs(&env), &region(&env), &100, &1_000_000);
    assert_eq!(res, Err(Ok(RegistryError::AgentAlreadyRegistered)));
}

#[test]
fn test_activate_requires_kyc_and_bond() {
    let (env, client, _owner, _op) = setup();
    let a = agent(&env);
    // Registered with bond but empty kyc_ref.
    client.register(&a, &Symbol::new(&env, ""), &region(&env), &100, &1_000_000);
    let res = client.try_activate(&a);
    assert_eq!(res, Err(Ok(RegistryError::MissingKyc)));

    // No-bond agent can't activate.
    let b = agent(&env);
    client.register(&b, &kycs(&env), &region(&env), &100, &1_000_000);
    client.withdraw_bond(&b); // bond now 0, still Pending
    let res = client.try_activate(&b);
    assert_eq!(res, Err(Ok(RegistryError::InvalidBond)));
}

#[test]
fn test_activate_sets_active_and_emits_event() {
    let (env, client, _owner, _op) = setup();
    let a = agent(&env);
    client.register(&a, &kycs(&env), &region(&env), &100, &1_000_000);
    client.activate(&a);
    let topic = last_event_topic0(&env);

    let info = client.get_agent(&a);
    assert_eq!(info.status, AgentStatus::Active);
    assert_eq!(topic, Symbol::new(&env, "AgentStatusChanged"));
}

#[test]
fn test_cannot_activate_active_agent() {
    let (env, client, _owner, _op) = setup();
    let a = agent(&env);
    client.register(&a, &kycs(&env), &region(&env), &100, &1_000_000);
    client.activate(&a);
    let res = client.try_activate(&a);
    assert_eq!(res, Err(Ok(RegistryError::InvalidStatusTransition)));
}

#[test]
fn test_suspend_then_withdraw_bond_allowed() {
    let (env, client, _owner, _op) = setup();
    let a = agent(&env);
    client.register(&a, &kycs(&env), &region(&env), &100, &1_000_000);
    client.activate(&a);
    client.suspend(&a);

    assert_eq!(client.get_agent(&a).status, AgentStatus::Suspended);
    client.withdraw_bond(&a);
    assert_eq!(client.get_agent(&a).bond_amount, 0);
}

#[test]
fn test_bond_frozen_while_active() {
    let (env, client, _owner, _op) = setup();
    let a = agent(&env);
    client.register(&a, &kycs(&env), &region(&env), &100, &1_000_000);
    client.activate(&a);
    let res = client.try_withdraw_bond(&a);
    assert_eq!(res, Err(Ok(RegistryError::BondFrozen)));
}

#[test]
fn test_top_up_bond() {
    let (env, client, _owner, _op) = setup();
    let a = agent(&env);
    client.register(&a, &kycs(&env), &region(&env), &100, &1_000_000);
    client.top_up_bond(&a, &50);
    assert_eq!(client.get_agent(&a).bond_amount, 150);
}

#[test]
fn test_set_reputation() {
    let (env, client, _owner, _op) = setup();
    let a = agent(&env);
    client.register(&a, &kycs(&env), &region(&env), &100, &1_000_000);
    client.set_reputation(&a, &42);
    assert_eq!(client.get_agent(&a).reputation, 42);
}

#[test]
fn test_bond_updated_event() {
    let (env, client, _owner, _op) = setup();
    let a = agent(&env);
    client.register(&a, &kycs(&env), &region(&env), &100, &1_000_000);
    client.top_up_bond(&a, &25);
    assert_eq!(last_event_topic0(&env), Symbol::new(&env, "BondUpdated"));
}

// ── Upgrade (issue #501) ─────────────────────────────────────────────────────

fn create_upgrade_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

#[test]
fn test_version_is_initialized() {
    let (_env, client, _owner, _op) = setup();
    assert_eq!(client.version(), 1);
}

#[test]
#[should_panic]
fn test_upgrade_requires_owner_auth() {
    let (env, client, _owner, _op) = setup();
    // Clear the blanket auth mock from `setup`, so the owner's `require_auth`
    // is actually enforced and the upgrade must be rejected.
    env.mock_auths(&[]);
    client.upgrade(&create_upgrade_hash(&env));
}

#[test]
#[should_panic]
fn test_upgrade_rejects_unauthorized_signer() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let operator = Address::generate(&env);
    let outsider = Address::generate(&env);

    let id = env.register(AgentRegistry, ());
    let client = AgentRegistryClient::new(&env, &id);
    env.mock_all_auths();
    client.init(&owner, &operator);

    let hash = create_upgrade_hash(&env);
    // Only the outsider is authorized; the owner never authorized this call,
    // so `owner.require_auth()` must reject it.
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &outsider,
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract: &id,
            fn_name: "upgrade",
            args: (hash.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    client.upgrade(&hash);
}
