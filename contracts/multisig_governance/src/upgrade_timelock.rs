//! Upgrade timelock + multi-sig governance (Issue #452).
//!
//! Every WASM upgrade of a DukaPay contract must flow through here:
//!
//! ```text
//!   queue_upgrade(target, new_wasm_hash)      // any upgrade signer / admin
//!        │  starts a 48h on-chain timelock
//!   approve_upgrade(signer)  × N              // needs `threshold` distinct signers
//!        │
//!   (wait 48h)
//!        │
//!   execute_upgrade(caller)                   // anyone; enforces timelock + threshold + not paused
//!        └── cross-contract call → target.upgrade(new_wasm_hash)
//! ```
//!
//! `cancel_upgrade` drops a pending upgrade (admin or any signer). The
//! `emergency_pause` circuit breaker lets any single signer freeze **all**
//! upgrade execution instantly when a critical vulnerability is suspected;
//! only the admin can `emergency_unpause`.
//!
//! The default quorum for DukaPay is 3-of-5: admin, security, ops, legal,
//! community — configured once via `configure_upgrade_signers`.

use soroban_sdk::{
    contractimpl, contracttype, symbol_short, Address, BytesN, Env, IntoVal, Map, Symbol, Vec,
};

use crate::{
    GovernanceContract, GovernanceContractArgs, GovernanceContractClient, GovernanceError,
};

/// 48 hours, enforced on-chain and NOT overridable by the proposer.
pub const UPGRADE_TIMELOCK_SECONDS: u64 = 172_800;
/// A queued upgrade that is neither executed nor cancelled expires after 14 days.
pub const UPGRADE_TTL_SECONDS: u64 = 1_209_600;
/// DukaPay quorum is 3-of-5; cap iteration/storage at 5 signers.
pub const MAX_UPGRADE_SIGNERS: u32 = 5;

const KEY_UPG_SIGNERS: Symbol = symbol_short!("UPGSIGN");
const KEY_UPG_THRESH: Symbol = symbol_short!("UPGTHR");
const KEY_UPG_PENDING: Symbol = symbol_short!("UPGPEND");
const KEY_UPG_PAUSED: Symbol = symbol_short!("UPGPAUSE");
const KEY_UPG_COUNT: Symbol = symbol_short!("UPGCNT");

#[contracttype]
#[derive(Clone)]
pub struct PendingUpgrade {
    pub id: u32,
    pub target: Address,
    pub new_wasm_hash: BytesN<32>,
    pub proposed_by: Address,
    pub proposed_at: u64,
    /// Ledger timestamp after which `execute_upgrade` is unblocked.
    pub executable_after: u64,
    pub approvals: Map<Address, bool>,
}

#[contracttype]
#[derive(Clone)]
pub struct UpgradeQueuedEvent {
    pub id: u32,
    pub target: Address,
    pub new_wasm_hash: BytesN<32>,
    pub executable_after: u64,
    pub proposed_by: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct UpgradeApprovedEvent {
    pub id: u32,
    pub signer: Address,
    pub approvals: u32,
    pub threshold: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct UpgradeExecutedEvent {
    pub id: u32,
    pub target: Address,
    pub new_wasm_hash: BytesN<32>,
    pub executed_by: Address,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct UpgradeCancelledEvent {
    pub id: u32,
    pub cancelled_by: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct UpgradePauseEvent {
    pub paused: bool,
    pub actor: Address,
    pub timestamp: u64,
}

#[contractimpl]
impl GovernanceContract {
    // ── Configuration ─────────────────────────────────────────────────────────

    /// Set (or rotate) the upgrade-governance quorum. Admin-only, and only when
    /// no upgrade is pending so a rotation can't strand an in-flight approval set.
    ///
    /// For DukaPay: `signers = [admin, security, ops, legal, community]`,
    /// `threshold = 3`.
    pub fn configure_upgrade_signers(
        env: Env,
        signers: Vec<Address>,
        threshold: u32,
    ) -> Result<(), GovernanceError> {
        let admin = GovernanceContract::read_admin(&env)?;
        admin.require_auth();

        if env.storage().instance().has(&KEY_UPG_PENDING) {
            return Err(GovernanceError::UpgradeAlreadyPending);
        }
        if signers.is_empty() {
            return Err(GovernanceError::EmptySignerList);
        }
        if signers.len() > MAX_UPGRADE_SIGNERS {
            return Err(GovernanceError::TooManyUpgradeSigners);
        }

        let mut unique: Vec<Address> = Vec::new(&env);
        for s in signers.iter() {
            if unique.iter().any(|x| x == s) {
                return Err(GovernanceError::DuplicateSigner);
            }
            unique.push_back(s);
        }
        if threshold < 1 {
            return Err(GovernanceError::InvalidUpgradeThreshold);
        }
        if threshold > unique.len() {
            return Err(GovernanceError::InvalidUpgradeThreshold);
        }

        env.storage().instance().set(&KEY_UPG_SIGNERS, &unique);
        env.storage().instance().set(&KEY_UPG_THRESH, &threshold);
        if !env.storage().instance().has(&KEY_UPG_PAUSED) {
            env.storage().instance().set(&KEY_UPG_PAUSED, &false);
        }
        Ok(())
    }

    // ── Queue ─────────────────────────────────────────────────────────────────

    /// Queue a WASM upgrade for `target`, starting the 48-hour timelock.
    /// Callable by any configured upgrade signer (or the admin). At most one
    /// upgrade may be pending at a time.
    pub fn queue_upgrade(
        env: Env,
        proposer: Address,
        target: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), GovernanceError> {
        proposer.require_auth();
        Self::require_signer_or_admin(&env, &proposer)?;

        if let Some(pending) = Self::load_pending(&env) {
            // Allow replacing an upgrade that has already expired.
            let now = env.ledger().timestamp();
            if now < pending.proposed_at.saturating_add(UPGRADE_TTL_SECONDS) {
                return Err(GovernanceError::UpgradeAlreadyPending);
            }
        }

        let now = env.ledger().timestamp();
        let count: u32 = env.storage().instance().get(&KEY_UPG_COUNT).unwrap_or(0);
        let id = count + 1;
        env.storage().instance().set(&KEY_UPG_COUNT, &id);

        let executable_after = now.saturating_add(UPGRADE_TIMELOCK_SECONDS);
        let pending = PendingUpgrade {
            id,
            target: target.clone(),
            new_wasm_hash: new_wasm_hash.clone(),
            proposed_by: proposer.clone(),
            proposed_at: now,
            executable_after,
            approvals: Map::new(&env),
        };
        env.storage().instance().set(&KEY_UPG_PENDING, &pending);

        env.events().publish(
            (symbol_short!("UpgQueue"), target.clone()),
            UpgradeQueuedEvent {
                id,
                target,
                new_wasm_hash,
                executable_after,
                proposed_by: proposer,
            },
        );
        Ok(())
    }

    // ── Approve ───────────────────────────────────────────────────────────────

    /// Record an approval from a configured signer. Idempotent.
    pub fn approve_upgrade(env: Env, signer: Address) -> Result<(), GovernanceError> {
        signer.require_auth();
        if !Self::is_upgrade_signer(&env, &signer) {
            return Err(GovernanceError::NotUpgradeSigner);
        }

        let mut pending = Self::load_pending(&env).ok_or(GovernanceError::NoPendingUpgrade)?;
        let now = env.ledger().timestamp();
        if now >= pending.proposed_at.saturating_add(UPGRADE_TTL_SECONDS) {
            return Err(GovernanceError::UpgradeExpired);
        }

        pending.approvals.set(signer.clone(), true);
        let approvals = pending.approvals.len();
        let threshold = Self::upgrade_threshold(&env)?;
        let id = pending.id;
        env.storage().instance().set(&KEY_UPG_PENDING, &pending);

        env.events().publish(
            (symbol_short!("UpgAppr"), signer.clone()),
            UpgradeApprovedEvent {
                id,
                signer,
                approvals,
                threshold,
            },
        );
        Ok(())
    }

    // ── Execute ───────────────────────────────────────────────────────────────

    /// Execute the pending upgrade once ALL hold:
    ///   1. upgrades are not paused (circuit breaker)
    ///   2. `now >= executable_after`           (48h timelock elapsed)
    ///   3. the upgrade has not expired (14d TTL)
    ///   4. `approvals >= threshold`             (3-of-5 by default)
    ///
    /// Performs a cross-contract call to `target.upgrade(new_wasm_hash)`. The
    /// target must have this governance contract as its admin.
    pub fn execute_upgrade(env: Env, caller: Address) -> Result<(), GovernanceError> {
        caller.require_auth();

        if Self::is_upgrade_paused(env.clone()) {
            return Err(GovernanceError::UpgradesPaused);
        }

        let pending = Self::load_pending(&env).ok_or(GovernanceError::NoPendingUpgrade)?;
        let now = env.ledger().timestamp();

        if now < pending.executable_after {
            return Err(GovernanceError::UpgradeTimelockNotElapsed);
        }
        if now >= pending.proposed_at.saturating_add(UPGRADE_TTL_SECONDS) {
            return Err(GovernanceError::UpgradeExpired);
        }
        let threshold = Self::upgrade_threshold(&env)?;
        if pending.approvals.len() < threshold {
            return Err(GovernanceError::UpgradeThresholdNotMet);
        }

        // Interaction first: if the target rejects the upgrade the whole tx traps
        // and no local state is mutated.
        env.invoke_contract::<()>(
            &pending.target,
            &symbol_short!("upgrade"),
            soroban_sdk::vec![&env, pending.new_wasm_hash.clone().into_val(&env)],
        );

        env.storage().instance().remove(&KEY_UPG_PENDING);

        env.events().publish(
            (symbol_short!("UpgExec"), pending.target.clone()),
            UpgradeExecutedEvent {
                id: pending.id,
                target: pending.target,
                new_wasm_hash: pending.new_wasm_hash,
                executed_by: caller,
                timestamp: now,
            },
        );
        Ok(())
    }

    // ── Cancel ────────────────────────────────────────────────────────────────

    /// Drop the pending upgrade. Admin or any configured signer may cancel.
    pub fn cancel_upgrade(env: Env, caller: Address) -> Result<(), GovernanceError> {
        caller.require_auth();
        Self::require_signer_or_admin(&env, &caller)?;

        let pending = Self::load_pending(&env).ok_or(GovernanceError::NoPendingUpgrade)?;
        env.storage().instance().remove(&KEY_UPG_PENDING);

        env.events().publish(
            (symbol_short!("UpgCncl"), caller.clone()),
            UpgradeCancelledEvent {
                id: pending.id,
                cancelled_by: caller,
            },
        );
        Ok(())
    }

    // ── Emergency circuit breaker ─────────────────────────────────────────────

    /// Freeze ALL upgrade execution immediately. Any single configured signer
    /// (or the admin) can trip this when a critical vulnerability is suspected.
    pub fn emergency_pause(env: Env, caller: Address) -> Result<(), GovernanceError> {
        caller.require_auth();
        Self::require_signer_or_admin(&env, &caller)?;
        env.storage().instance().set(&KEY_UPG_PAUSED, &true);
        env.events().publish(
            (symbol_short!("UpgPause"),),
            UpgradePauseEvent {
                paused: true,
                actor: caller,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    /// Lift the upgrade freeze. Admin-only — deliberately higher-bar than pausing.
    pub fn emergency_unpause(env: Env) -> Result<(), GovernanceError> {
        let admin = GovernanceContract::read_admin(&env)?;
        admin.require_auth();
        env.storage().instance().set(&KEY_UPG_PAUSED, &false);
        env.events().publish(
            (symbol_short!("UpgUnpse"),),
            UpgradePauseEvent {
                paused: false,
                actor: admin,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_pending_upgrade(env: Env) -> Option<PendingUpgrade> {
        Self::load_pending(&env)
    }

    pub fn is_upgrade_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&KEY_UPG_PAUSED)
            .unwrap_or(false)
    }

    pub fn get_upgrade_signers(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&KEY_UPG_SIGNERS)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn get_upgrade_threshold(env: Env) -> u32 {
        env.storage().instance().get(&KEY_UPG_THRESH).unwrap_or(0)
    }

    pub fn get_upgrade_approval_count(env: Env) -> Result<u32, GovernanceError> {
        Ok(Self::load_pending(&env)
            .ok_or(GovernanceError::NoPendingUpgrade)?
            .approvals
            .len())
    }

    pub fn has_approved_upgrade(env: Env, signer: Address) -> Result<bool, GovernanceError> {
        Ok(Self::load_pending(&env)
            .ok_or(GovernanceError::NoPendingUpgrade)?
            .approvals
            .get(signer)
            .unwrap_or(false))
    }

    /// Seconds until `execute_upgrade` is unblocked (0 once elapsed / none pending).
    pub fn upgrade_timelock_remaining(env: Env) -> u64 {
        match Self::load_pending(&env) {
            None => 0,
            Some(p) => {
                let now = env.ledger().timestamp();
                p.executable_after.saturating_sub(now)
            }
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn load_pending(env: &Env) -> Option<PendingUpgrade> {
        env.storage().instance().get(&KEY_UPG_PENDING)
    }

    fn upgrade_threshold(env: &Env) -> Result<u32, GovernanceError> {
        env.storage()
            .instance()
            .get(&KEY_UPG_THRESH)
            .filter(|&t| t > 0u32)
            .ok_or(GovernanceError::UpgradeGovernanceNotConfigured)
    }

    fn is_upgrade_signer(env: &Env, who: &Address) -> bool {
        let signers: Vec<Address> = match env.storage().instance().get(&KEY_UPG_SIGNERS) {
            Some(s) => s,
            None => return false,
        };
        signers.iter().any(|s| s == *who)
    }

    fn require_signer_or_admin(env: &Env, who: &Address) -> Result<(), GovernanceError> {
        if Self::is_upgrade_signer(env, who) {
            return Ok(());
        }
        match GovernanceContract::read_admin(env) {
            Ok(admin) if admin == *who => Ok(()),
            Ok(_) => Err(GovernanceError::NotUpgradeSigner),
            Err(e) => Err(e),
        }
    }
}
