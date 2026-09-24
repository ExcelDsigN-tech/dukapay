#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use settlement_netter::{SettlementNetter, SettlementNetterClient, SettlementError};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env};

#[derive(Arbitrary, Debug)]
enum FuzzAction {
    Init {},
    BatchSettle {
        num_loans: u8,
        amount: i128,
    },
    MerkleRoot {
        num_loans: u8,
    },
}

fn setup_env() -> (Env, Address, Address, SettlementNetterClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let owner = Address::generate(&env);
    let operator = Address::generate(&env);
    let id = env.register(SettlementNetter, ());
    let client = SettlementNetterClient::new(&env, &id);
    client.init(&owner, &operator, 64, 100).unwrap();
    (env, owner, operator, client)
}

fuzz_target!(|action: FuzzAction| {
    let (env, _owner, _operator, client) = setup_env();
    let a = Address::generate(&env);
    let b = Address::generate(&env);

    match action {
        FuzzAction::Init {} => {
            let env2 = Env::default();
            env2.mock_all_auths();
            let owner = Address::generate(&env2);
            let operator = Address::generate(&env2);
            let id = env2.register(SettlementNetter, ());
            let client = SettlementNetterClient::new(&env2, &id);
            let _ = client.init(&owner, &operator, 64, 100);
            let _ = client.try_init(&owner, &operator, 64, 100);
        }
        FuzzAction::BatchSettle { num_loans, amount } => {
            let num = num_loans as usize;
            if num == 0 {
                return;
            }

            let mut loans: Vec<settlement_netter::LoanSettlement> = Vec::new(&env);
            let mut sum: i128 = 0;

            for i in 0..num {
                let borrower = if i % 2 == 0 { a.clone() } else { b.clone() };
                let amt = if i % 2 == 0 { amount } else { -amount };
                sum = sum.saturating_add(amt);
                loans.push_back(settlement_netter::LoanSettlement {
                    loan_id: i as u32,
                    borrower,
                    amount: amt,
                    status: settlement_netter::SettlementStatus::Pending,
                });
            }

            // Adjust last entry to make net zero
            if num > 1 {
                let last_loan = loans.last().unwrap();
                let adjustment = -sum - last_loan.amount;
                if last_loan.amount + adjustment >= 0 {
                    let mut adjusted = last_loan.clone();
                    adjusted.amount = last_loan.amount + adjustment;
                    loans.set((num - 1) as u32, adjusted);
                } else {
                    // Skip if adjustment would make amount negative
                    return;
                }
            } else {
                // Single loan with net-zero (amount must be 0)
                if amount != 0 {
                    return;
                }
            }

            let root = client.compute_merkle_root(&loans);

            // Invariant: net must be zero for success
            let result = client.try_batch_settle(&loans, root);
            if result.is_ok() {
                // If it succeeded, net was zero - verify loans were stored
                for i in 0..num {
                    let stored = client.get_loan(i as u32);
                    assert!(stored.is_ok());
                }
            }
        }
        FuzzAction::MerkleRoot { num_loans } => {
            let num = num_loans as usize;
            if num == 0 {
                return;
            }

            let mut loans: Vec<settlement_netter::LoanSettlement> = Vec::new(&env);
            for i in 0..num {
                let borrower = if i % 2 == 0 { a.clone() } else { b.clone() };
                loans.push_back(settlement_netter::LoanSettlement {
                    loan_id: i as u32,
                    borrower,
                    amount: (i as i128) * 100,
                    status: settlement_netter::SettlementStatus::Pending,
                });
            }

            let root1 = client.compute_merkle_root(&loans);
            let root2 = client.compute_merkle_root(&loans);
            assert_eq!(root1, root2);
        }
    }
});
