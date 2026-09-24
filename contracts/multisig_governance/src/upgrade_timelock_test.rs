//! Tests for the upgrade timelock + multi-sig governance (Issue #452).

use crate::upgrade_timelock::{UPGRADE_TIMELOCK_SECONDS, UPGRADE_TTL_SECONDS};
use crate::{GovernanceContract, GovernanceContractClient};
use soroban_sdk::testutils::{Address as _, Ledger, LedgerInfo};
use soroban_sdk::{contract, contractimpl, symbol_short, Address, BytesN, Env, Symbol, Vec};

// ── Mock upgradeable target ───────────────────────────────────────────────────

#[contract]
pub struct MockUpgradeable;

#[contractimpl]
impl MockUpgradeable {
    pub fn set_admin(env: Env, new_admin: Address) {
        env.storage()
            .instance()
            .set(&symbol_short!("admin"), &new_admin);
    }
    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&symbol_short!("admin"))
            .unwrap()
    }
    /// Mirrors the real contracts: only the admin (the governance contract) may
    /// upgrade. Records the applied hash so tests can assert the call landed.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("admin"))
            .unwrap();
        admin.require_auth();
        env.storage()
            .instance()
            .set(&Symbol::new(&env, "applied"), &new_wasm_hash);
    }
    pub fn applied_hash(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&Symbol::new(&env, "applied"))
    }
}

fn set_ts(env: &Env, ts: u64) {
    env.ledger().set(LedgerInfo {
        timestamp: ts,
        protocol_version: 22,
        sequence_number: 1000,
        network_id: Default::default(),
        base_reserve: 5_000_000,
        min_temp_entry_ttl: 1_000_000,
        min_persistent_entry_ttl: 1_000_000,
        max_entry_ttl: 10_000_000,
    });
}

struct Ctx {
    env: Env,
    gov: GovernanceContractClient<'static>,
    target: Address,
    admin: Address,
    signers: [Address; 5],
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();
    set_ts(&env, 1_000_000);

    let gov_id = env.register(GovernanceContract, ());
    let gov = GovernanceContractClient::new(&env, &gov_id);

    let target_id = env.register(MockUpgradeable, ());
    let target_client = MockUpgradeableClient::new(&env, &target_id);
    // Governance is the admin of the target — upgrades must route through it.
    target_client.set_admin(&gov_id);

    let admin = Address::generate(&env);
    gov.initialize(&admin, &target_id);

    let signers = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    let mut v = Vec::new(&env);
    for s in &signers {
        v.push_back(s.clone());
    }
    gov.configure_upgrade_signers(&v, &3);

    Ctx {
        env,
        gov,
        target: target_id,
        admin,
        signers,
    }
}

fn hash(env: &Env, b: u8) -> BytesN<32> {
    BytesN::from_array(env, &[b; 32])
}

#[test]
fn configures_3_of_5_quorum() {
    let c = setup();
    assert_eq!(c.gov.get_upgrade_signers().len(), 5);
    assert_eq!(c.gov.get_upgrade_threshold(), 3);
    assert!(!c.gov.is_upgrade_paused());
}

#[test]
#[should_panic]
fn configure_rejects_threshold_above_signers() {
    let c = setup();
    let mut v = Vec::new(&c.env);
    v.push_back(c.signers[0].clone());
    v.push_back(c.signers[1].clone());
    c.gov.configure_upgrade_signers(&v, &3);
}

#[test]
fn full_upgrade_flow_enforces_timelock_and_threshold() {
    let c = setup();
    let wasm = hash(&c.env, 7);

    c.gov.queue_upgrade(&c.signers[0], &c.target, &wasm);
    assert_eq!(c.gov.upgrade_timelock_remaining(), UPGRADE_TIMELOCK_SECONDS);

    c.gov.approve_upgrade(&c.signers[0]);
    c.gov.approve_upgrade(&c.signers[1]);
    c.gov.approve_upgrade(&c.signers[2]);

    // Timelock still active → execution blocked.
    let early = c.gov.try_execute_upgrade(&c.admin);
    assert!(early.is_err());

    set_ts(&c.env, 1_000_000 + UPGRADE_TIMELOCK_SECONDS + 1);
    c.gov.execute_upgrade(&c.admin);

    let target = MockUpgradeableClient::new(&c.env, &c.target);
    assert_eq!(target.applied_hash(), Some(wasm));
    assert!(c.gov.get_pending_upgrade().is_none());
}

#[test]
fn execute_blocked_below_threshold() {
    let c = setup();
    c.gov
        .queue_upgrade(&c.signers[0], &c.target, &hash(&c.env, 1));
    c.gov.approve_upgrade(&c.signers[0]);
    c.gov.approve_upgrade(&c.signers[1]);

    set_ts(&c.env, 1_000_000 + UPGRADE_TIMELOCK_SECONDS + 1);
    let res = c.gov.try_execute_upgrade(&c.admin);
    assert!(res.is_err());
}

#[test]
fn idempotent_approval_does_not_double_count() {
    let c = setup();
    c.gov
        .queue_upgrade(&c.signers[0], &c.target, &hash(&c.env, 1));
    c.gov.approve_upgrade(&c.signers[0]);
    c.gov.approve_upgrade(&c.signers[0]);
    c.gov.approve_upgrade(&c.signers[0]);
    assert_eq!(c.gov.get_upgrade_approval_count(), 1);
}

#[test]
#[should_panic]
fn non_signer_cannot_approve() {
    let c = setup();
    c.gov
        .queue_upgrade(&c.signers[0], &c.target, &hash(&c.env, 1));
    let stranger = Address::generate(&c.env);
    c.gov.approve_upgrade(&stranger);
}

#[test]
#[should_panic]
fn non_signer_cannot_queue() {
    let c = setup();
    let stranger = Address::generate(&c.env);
    c.gov.queue_upgrade(&stranger, &c.target, &hash(&c.env, 1));
}

#[test]
fn emergency_pause_blocks_execution_and_unpause_restores() {
    let c = setup();
    let wasm = hash(&c.env, 9);
    c.gov.queue_upgrade(&c.signers[0], &c.target, &wasm);
    c.gov.approve_upgrade(&c.signers[0]);
    c.gov.approve_upgrade(&c.signers[1]);
    c.gov.approve_upgrade(&c.signers[2]);
    set_ts(&c.env, 1_000_000 + UPGRADE_TIMELOCK_SECONDS + 1);

    // Any single signer trips the breaker.
    c.gov.emergency_pause(&c.signers[4]);
    assert!(c.gov.is_upgrade_paused());
    assert!(c.gov.try_execute_upgrade(&c.admin).is_err());

    // Only the admin can lift it.
    c.gov.emergency_unpause();
    assert!(!c.gov.is_upgrade_paused());
    c.gov.execute_upgrade(&c.admin);
    let target = MockUpgradeableClient::new(&c.env, &c.target);
    assert_eq!(target.applied_hash(), Some(wasm));
}

#[test]
#[should_panic]
fn only_admin_can_unpause() {
    let c = setup();
    c.gov.emergency_pause(&c.signers[0]);
    c.env.mock_auths(&[]);
    c.gov.emergency_unpause();
}

#[test]
fn cancel_upgrade_clears_pending_and_allows_requeue() {
    let c = setup();
    c.gov
        .queue_upgrade(&c.signers[0], &c.target, &hash(&c.env, 1));
    c.gov.cancel_upgrade(&c.admin);
    assert!(c.gov.get_pending_upgrade().is_none());

    // A fresh upgrade can be queued immediately after cancellation.
    c.gov
        .queue_upgrade(&c.signers[1], &c.target, &hash(&c.env, 2));
    assert!(c.gov.get_pending_upgrade().is_some());
}

#[test]
#[should_panic]
fn cannot_queue_while_one_is_pending() {
    let c = setup();
    c.gov
        .queue_upgrade(&c.signers[0], &c.target, &hash(&c.env, 1));
    c.gov
        .queue_upgrade(&c.signers[1], &c.target, &hash(&c.env, 2));
}

#[test]
fn expired_upgrade_cannot_execute_but_can_be_replaced() {
    let c = setup();
    c.gov
        .queue_upgrade(&c.signers[0], &c.target, &hash(&c.env, 1));
    c.gov.approve_upgrade(&c.signers[0]);
    c.gov.approve_upgrade(&c.signers[1]);
    c.gov.approve_upgrade(&c.signers[2]);

    set_ts(&c.env, 1_000_000 + UPGRADE_TTL_SECONDS + 1);
    assert!(c.gov.try_execute_upgrade(&c.admin).is_err());

    // Past TTL, a replacement upgrade may be queued.
    c.gov
        .queue_upgrade(&c.signers[0], &c.target, &hash(&c.env, 2));
    assert_eq!(
        c.gov.get_pending_upgrade().unwrap().new_wasm_hash,
        hash(&c.env, 2)
    );
}

#[test]
#[should_panic]
fn execute_without_configured_governance_fails() {
    let env = Env::default();
    env.mock_all_auths();
    set_ts(&env, 1_000_000);
    let gov_id = env.register(GovernanceContract, ());
    let gov = GovernanceContractClient::new(&env, &gov_id);
    let target_id = env.register(MockUpgradeable, ());
    let admin = Address::generate(&env);
    gov.initialize(&admin, &target_id);
    // No configure_upgrade_signers → queue must fail (admin still allowed to queue,
    // but there is no threshold configured so execution can never succeed).
    gov.queue_upgrade(&admin, &target_id, &BytesN::from_array(&env, &[1; 32]));
    set_ts(&env, 1_000_000 + UPGRADE_TIMELOCK_SECONDS + 1);
    gov.execute_upgrade(&admin);
}
