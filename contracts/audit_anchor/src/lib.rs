#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, BytesN, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum AnchorError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    EpochAlreadyAnchored = 3,
    EmptyEpoch = 4,
}

#[contracttype]
pub enum DataKey {
    Owner,
    Root(u64),
    LeafCount(u64),
}

#[contract]
pub struct AuditAnchor;

#[contractimpl]
impl AuditAnchor {
    pub fn init(env: Env, owner: Address) -> Result<(), AnchorError> {
        if env.storage().instance().has(&DataKey::Owner) {
            return Err(AnchorError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Owner, &owner);
        Ok(())
    }

    pub fn anchor(
        env: Env,
        epoch: u64,
        root: BytesN<32>,
        leaf_count: u32,
    ) -> Result<(), AnchorError> {
        let owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(AnchorError::NotInitialized)?;
        owner.require_auth();
        if leaf_count == 0 {
            return Err(AnchorError::EmptyEpoch);
        }
        if env.storage().persistent().has(&DataKey::Root(epoch)) {
            return Err(AnchorError::EpochAlreadyAnchored);
        }
        env.storage().persistent().set(&DataKey::Root(epoch), &root);
        env.storage()
            .persistent()
            .set(&DataKey::LeafCount(epoch), &leaf_count);
        env.events()
            .publish((soroban_sdk::symbol_short!(auditroot), epoch), (root, leaf_count));
        Ok(())
    }

    pub fn get_root(env: Env, epoch: u64) -> Option<BytesN<32>> {
        env.storage().persistent().get(&DataKey::Root(epoch))
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

    #[test]
    fn owner_can_anchor_each_epoch_once() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AuditAnchor, ());
        let client = AuditAnchorClient::new(&env, &contract_id);
        let owner = Address::generate(&env);
        client.init(&owner);
        let root = BytesN::from_array(&env, &[7; 32]);
        client.anchor(&1, &root, &3);
        assert_eq!(client.get_root(&1), Some(root));
        assert!(client.try_anchor(&1, &BytesN::from_array(&env, &[8; 32]), &3).is_err());
    }
}
