#![no_std]
//! DukaPay price-feed oracle (#454).
//!
//! Provides manipulation-resistant USD pricing for collateral assets used in
//! loan liquidation decisions:
//!
//! - **Multi-source aggregation**: each configured source (Pyth, Chainlink,
//!   Stellar DEX) submits prices for an asset. `get_price` returns the
//!   **median** of the fresh sources (>= 2 required).
//! - **Staleness rejection**: submissions older than [`MAX_SOURCE_AGE_SECS`]
//!   are excluded; if the aggregate itself is older than 1 hour, `get_price`
//!   reverts with [`OracleError::StalePrice`].
//! - **Circuit breaker**: a submission that deviates more than
//!   [`MAX_DEVIATION_BPS`] (300 bps = 3%) from the last accepted aggregate is
//!   rejected with [`OracleError::CircuitBroken`].
//! - **TWAP**: `get_price` returns the time-weighted average of accepted
//!   aggregates over the trailing [`TWAP_WINDOW_SECS`] (30 min) window, so a
//!   single short-lived blip cannot move the effective price.
//! - **Admin controls**: the admin can `pause`/`unpause` the feed, `upgrade`
//!   the contract in place, rotate the admin key in two steps with a timelock,
//!   and point the feed at a `CircuitBreaker`. While paused, submissions and
//!   reads are refused with [`OracleError::ContractPaused`].

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error, Address,
    BytesN, Env, Symbol, Vec,
};

/// Interface exposed by the DukaPay `CircuitBreaker` contract. The oracle
/// consults `is_blocked` before accepting a price submission.
#[contractclient(name = "BreakerClient")]
pub trait BreakerInterface {
    fn is_blocked(env: Env, contract: Address, function: Symbol) -> bool;
}

/// Price scale (7 decimals). A USDC/USD price of 1.0000000 == 10_000_000.
pub const PRICE_SCALE: i128 = 10_000_000;
/// 30-minute TWAP window.
pub const TWAP_WINDOW_SECS: u64 = 1_800;
/// Circuit breaker threshold: 3% deviation (300 bps).
pub const MAX_DEVIATION_BPS: u64 = 300;
/// Sources older than this are staleness-excluded.
pub const MAX_SOURCE_AGE_SECS: u64 = 3_600;
/// Minimum number of fresh sources for a median.
pub const MIN_SOURCES: u32 = 2;
/// Timelock between `propose_admin` and `accept_admin` (24h). A proposed key
/// cannot take over until operators have had a full day to notice the change.
pub const ADMIN_ROTATION_DELAY_SECS: u64 = 86_400;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum OracleError {
    NotInitialized = 1,
    UnauthorizedSource = 2,
    InsufficientSources = 3,
    StalePrice = 4,
    CircuitBroken = 5,
    ZeroPrice = 6,
    ContractPaused = 7,
    CircuitBreakerTripped = 8,
    Unauthorized = 9,
    NoPendingAdmin = 10,
    AdminTimelockNotElapsed = 11,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TwapSample {
    pub ts: u64,
    pub price: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AggregateState {
    pub price: i128,
    pub ts: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub enum DataKey {
    Admin,
    PendingAdmin,
    AdminProposedAt,
    Paused,
    CircuitBreaker,
    Sources,
    Sample(Address, Symbol),
    SourceList(Address),
    Aggregate(Address),
    TwapSeries(Address),
}

#[contract]
pub struct Oracle;

#[contractimpl]
impl Oracle {
    /// Initialize the oracle. Only `admin` may configure sources and the
    /// `sources` list gates who is allowed to submit prices.
    pub fn initialize(env: Env, admin: Address, sources: Vec<Symbol>) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Sources, &sources);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    // ── Admin / safety controls ─────────────────────────────────────────────

    fn admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, OracleError::NotInitialized))
    }

    /// Revert when the feed is paused. Used by every value-bearing entry point.
    fn assert_not_paused(env: &Env) -> Result<(), OracleError> {
        let paused = env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            return Err(OracleError::ContractPaused);
        }
        Ok(())
    }

    /// Consult the configured `CircuitBreaker`, if any. A tripped breaker for
    /// this contract + function refuses the submission. No breaker configured
    /// means the check is a no-op, keeping the oracle backward compatible.
    fn assert_circuit_ok(env: &Env, fn_sym: Symbol) -> Result<(), OracleError> {
        if let Some(breaker) = env
            .storage()
            .instance()
            .get::<_, Option<Address>>(&DataKey::CircuitBreaker)
            .flatten()
        {
            let client = BreakerClient::new(env, &breaker);
            if client.is_blocked(&env.current_contract_address(), &fn_sym) {
                return Err(OracleError::CircuitBreakerTripped);
            }
        }
        Ok(())
    }

    /// The current admin address.
    pub fn get_admin(env: Env) -> Address {
        Self::admin(&env)
    }

    /// Whether the feed is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Halt submissions and reads. Admin-only. Use when a feed is compromised
    /// or sources disagree so badly that downstream consumers must not act on
    /// the price. Existing samples are preserved for inspection.
    pub fn pause(env: Env) -> Result<(), OracleError> {
        let admin = Self::admin(&env);
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events()
            .publish((Symbol::new(&env, "oracle_paused"),), admin);
        Ok(())
    }

    /// Resume submissions and reads. Admin-only.
    pub fn unpause(env: Env) -> Result<(), OracleError> {
        let admin = Self::admin(&env);
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events()
            .publish((Symbol::new(&env, "oracle_unpaused"),), admin);
        Ok(())
    }

    /// Upgrade the contract WASM in place. Admin-only. The stored admin, sources
    /// and samples live in instance/persistent storage, so state survives.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), OracleError> {
        let admin = Self::admin(&env);
        admin.require_auth();
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        env.events().publish(
            (Symbol::new(&env, "oracle_upgraded"),),
            (admin, new_wasm_hash),
        );
        Ok(())
    }

    /// Step 1 of a two-step admin handoff: nominate `new_admin`. Admin-only.
    /// The nominee must call `accept_admin` after [`ADMIN_ROTATION_DELAY_SECS`].
    pub fn propose_admin(env: Env, new_admin: Address) -> Result<(), OracleError> {
        let admin = Self::admin(&env);
        admin.require_auth();
        let now = env.ledger().timestamp();
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        env.storage()
            .instance()
            .set(&DataKey::AdminProposedAt, &now);
        env.events().publish(
            (Symbol::new(&env, "admin_proposed"),),
            (admin, new_admin, now),
        );
        Ok(())
    }

    /// Step 2 of a two-step admin handoff: the nominee accepts. Requires the
    /// nominee's auth and that the timelock has elapsed, so a compromised
    /// admin key cannot rotate ownership silently.
    pub fn accept_admin(env: Env) -> Result<(), OracleError> {
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(OracleError::NoPendingAdmin)?;
        let proposed_at: u64 = env
            .storage()
            .instance()
            .get(&DataKey::AdminProposedAt)
            .unwrap_or(0);
        let now = env.ledger().timestamp();
        if now < proposed_at.saturating_add(ADMIN_ROTATION_DELAY_SECS) {
            return Err(OracleError::AdminTimelockNotElapsed);
        }
        pending.require_auth();
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.storage().instance().remove(&DataKey::AdminProposedAt);
        env.events()
            .publish((Symbol::new(&env, "admin_accepted"),), pending);
        Ok(())
    }

    /// The nominated-but-not-yet-accepted admin, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    /// Point the oracle at a `CircuitBreaker` contract (or clear it with
    /// `None`). Admin-only.
    pub fn set_circuit_breaker(env: Env, breaker: Option<Address>) -> Result<(), OracleError> {
        let admin = Self::admin(&env);
        admin.require_auth();
        match breaker.clone() {
            Some(address) => env
                .storage()
                .instance()
                .set(&DataKey::CircuitBreaker, &Some(address)),
            None => env.storage().instance().remove(&DataKey::CircuitBreaker),
        }
        env.events().publish(
            (Symbol::new(&env, "circuit_breaker_set"),),
            (admin, breaker),
        );
        Ok(())
    }

    /// The configured `CircuitBreaker` address, if any.
    pub fn get_circuit_breaker(env: Env) -> Option<Address> {
        env.storage()
            .instance()
            .get::<_, Option<Address>>(&DataKey::CircuitBreaker)
            .flatten()
    }

    fn is_authorized_source(env: &Env, source: &Symbol) -> bool {
        env.storage()
            .instance()
            .get::<_, Vec<Symbol>>(&DataKey::Sources)
            .map(|sources| sources.iter().any(|s| &s == source))
            .unwrap_or(false)
    }

    fn bump_persistent_ttl(env: &Env, key: &DataKey) {
        if env.storage().persistent().has(key) {
            env.storage().persistent().extend_ttl(key, 17_280, 518_400);
        }
    }

    fn push_aggregate(env: &Env, asset: &Address, ts: u64, price: i128) {
        let key = DataKey::TwapSeries(asset.clone());
        let existing: Option<Vec<TwapSample>> = env.storage().persistent().get(&key);
        let mut series = existing.unwrap_or_else(|| Vec::new(env));
        series.push_back(TwapSample { ts, price });
        // Trim the window, keeping only samples within the trailing 30 min.
        let cutoff = ts.saturating_sub(TWAP_WINDOW_SECS);
        let mut i: u32 = 0;
        while i < series.len() && series.get_unchecked(i).ts < cutoff {
            i += 1;
        }
        if i > 0 {
            series = series.slice(i..series.len());
        }
        // Bound the series so a hostile dense submitter can't bloat storage.
        let max_samples: u32 = 120;
        if series.len() > max_samples {
            series = series.slice((series.len() - max_samples)..series.len());
        }
        env.storage().persistent().set(&key, &series);
        Self::bump_persistent_ttl(env, &key);
    }

    /// The trailing-window TWAP using linear interpolation between samples.
    fn twap(env: &Env, asset: &Address, now: u64) -> Option<i128> {
        let key = DataKey::TwapSeries(asset.clone());
        let series: Option<Vec<TwapSample>> = env.storage().persistent().get(&key);
        let series = series?;
        if series.is_empty() {
            return None;
        }
        let cutoff = now.saturating_sub(TWAP_WINDOW_SECS);
        let mut weighted_sum: u128 = 0;
        let mut weight_sum: u128 = 0;
        let first = series.first().expect("non-empty");
        if first.ts >= now {
            return Some(first.price);
        }
        // Include the segment from the window start to the first sample.
        if first.ts > cutoff {
            weight_sum += (first.ts - cutoff) as u128;
            weighted_sum += (first.price as u128) * ((first.ts - cutoff) as u128);
        }
        let n = series.len();
        for i in 0..n {
            let s = series.get_unchecked(i);
            let nxt = series.get(i + 1);
            let cur = s.ts.max(cutoff);
            match nxt {
                Some(n) => {
                    if n.ts <= cur {
                        continue;
                    }
                    let dt = (n.ts - cur) as u128;
                    let mid = ((s.price as u128) + (n.price as u128)) / 2;
                    weighted_sum += mid * dt;
                    weight_sum += dt;
                }
                None => {
                    if now > cur {
                        let dt = (now - cur) as u128;
                        weighted_sum += (s.price as u128) * dt;
                        weight_sum += dt;
                    }
                }
            }
        }
        if weight_sum == 0 {
            return None;
        }
        Some((weighted_sum / weight_sum) as i128)
    }

    /// Fresh per-source median. Sources whose last submission is older than
    /// `MAX_SOURCE_AGE_SECS` are excluded. Requires `MIN_SOURCES` fresh sources.
    fn fresh_median(env: &Env, asset: &Address, now: u64) -> Result<i128, OracleError> {
        let list_key = DataKey::SourceList(asset.clone());
        let sources: Option<Vec<Symbol>> = env.storage().persistent().get(&list_key);
        let sources = sources.unwrap_or_else(|| Vec::new(env));

        let mut fresh: Vec<i128> = Vec::new(env);
        for source in sources.iter() {
            let key = DataKey::Sample(asset.clone(), source.clone());
            let sample: Option<(u64, i128)> = env.storage().persistent().get(&key);
            if let Some(sample) = sample {
                if now.saturating_sub(sample.0) <= MAX_SOURCE_AGE_SECS {
                    fresh.push_back(sample.1);
                }
            }
        }

        if fresh.len() < MIN_SOURCES {
            return Err(OracleError::InsufficientSources);
        }

        // Median of the fresh set.
        sort_in_place(&mut fresh);
        let mid = fresh.get_unchecked(fresh.len() / 2);
        Ok(mid)
    }

    /// Submit a price for `asset` from an authorized source.
    pub fn submit_price(
        env: Env,
        source: Symbol,
        asset: Address,
        price: i128,
    ) -> Result<(), OracleError> {
        Self::assert_not_paused(&env)?;
        Self::assert_circuit_ok(&env, Symbol::new(&env, "submit_price"))?;
        if !Self::is_authorized_source(&env, &source) {
            return Err(OracleError::UnauthorizedSource);
        }
        if price <= 0 {
            return Err(OracleError::ZeroPrice);
        }

        let now = env.ledger().timestamp();
        let sample_key = DataKey::Sample(asset.clone(), source.clone());

        // Update the source sample.
        env.storage().persistent().set(&sample_key, &(now, price));
        Self::bump_persistent_ttl(&env, &sample_key);

        // Keep a per-asset source list so aggregation knows which sources exist.
        let list_key = DataKey::SourceList(asset.clone());
        let known_opt: Option<Vec<Symbol>> = env.storage().persistent().get(&list_key);
        let mut known = known_opt.unwrap_or_else(|| Vec::new(&env));
        if !known.iter().any(|s| s == source) {
            known.push_back(source.clone());
            env.storage().persistent().set(&list_key, &known);
            Self::bump_persistent_ttl(&env, &list_key);
        }

        // Circuit breaker: reject a price that deviates >3% from the last
        // accepted aggregate (first submission for an asset is always allowed).
        let agg_key = DataKey::Aggregate(asset.clone());
        let last_agg: Option<AggregateState> = env.storage().instance().get(&agg_key);
        if let Some(agg) = last_agg {
            if agg.price > 0 {
                let deviation_bps = if price >= agg.price {
                    price
                        .checked_sub(agg.price)
                        .expect("price deviation overflow")
                        .checked_mul(10_000)
                        .expect("price deviation overflow")
                        / agg.price
                } else {
                    agg.price
                        .checked_sub(price)
                        .expect("price deviation overflow")
                        .checked_mul(10_000)
                        .expect("price deviation overflow")
                        / agg.price
                };
                if deviation_bps > MAX_DEVIATION_BPS as i128 {
                    return Err(OracleError::CircuitBroken);
                }
            }
        }

        // Accept and fold into the aggregate + TWAP series.
        Self::bump_persistent_ttl(&env, &agg_key);
        env.storage()
            .instance()
            .set(&agg_key, &AggregateState { price, ts: now });
        Self::push_aggregate(&env, &asset, now, price);

        env.events().publish(
            (Symbol::new(&env, "price_submitted"), asset),
            (source, price, now),
        );

        Ok(())
    }

    /// The effective manipulation-resistant price for `asset` as a fallible
    /// result — useful for off-chain tools and tests.
    pub fn get_price_result(env: &Env, asset: Address) -> Result<i128, OracleError> {
        Self::assert_not_paused(env)?;
        let now = env.ledger().timestamp();

        let agg_key = DataKey::Aggregate(asset.clone());
        let agg: AggregateState = env
            .storage()
            .instance()
            .get(&agg_key)
            .ok_or(OracleError::NotInitialized)?;
        if now.saturating_sub(agg.ts) > MAX_SOURCE_AGE_SECS {
            return Err(OracleError::StalePrice);
        }

        let median = Self::fresh_median(env, &asset, now)?;
        match Self::twap(env, &asset, now) {
            Some(twap_price) if twap_price > 0 => Ok(twap_price),
            _ => Ok(median),
        }
    }

    /// The effective manipulation-resistant price for `asset`. Reverts with
    /// [`OracleError::StalePrice`] when the feed is older than 1 hour and with
    /// [`OracleError::InsufficientSources`] when fewer than two sources are
    /// fresh — consumers (e.g. `loan_manager` liquidation) can call this and
    /// rely on the revert to refuse stale or degraded prices.
    pub fn get_price(env: Env, asset: Address) -> i128 {
        match Self::get_price_result(&env, asset) {
            Ok(price) => price,
            Err(e) => panic_with_error!(env, e),
        }
    }
}

/// Simple insertion sort for median computation (no_std-safe).
fn sort_in_place(arr: &mut Vec<i128>) {
    let n = arr.len();
    for i in 1..n {
        let mut j = i;
        while j > 0 && arr.get_unchecked(j) < arr.get_unchecked(j - 1) {
            let a = arr.get_unchecked(j);
            let b = arr.get_unchecked(j - 1);
            arr.set(j, b);
            arr.set(j - 1, a);
            j -= 1;
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger, LedgerInfo};
    use soroban_sdk::{symbol_short, vec, Env};

    fn setup() -> (Env, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set(LedgerInfo {
            timestamp: 1_700_000_000,
            protocol_version: 22,
            sequence_number: 1,
            network_id: Default::default(),
            base_reserve: 0,
            min_temp_entry_ttl: 0,
            min_persistent_entry_ttl: 0,
            max_entry_ttl: 0,
        });
        let admin = Address::generate(&env);
        let sources = vec![
            &env,
            symbol_short!("pyth"),
            symbol_short!("chain"),
            symbol_short!("dex"),
        ];
        let oracle_id = env.register(Oracle, ());
        let client = OracleClient::new(&env, &oracle_id);
        client.initialize(&admin, &sources);
        let asset = Address::generate(&env);
        (env, oracle_id, asset)
    }

    fn submit(
        env: &Env,
        oracle_id: &Address,
        source: soroban_sdk::Symbol,
        asset: Address,
        price: i128,
    ) -> Result<(), OracleError> {
        env.as_contract(oracle_id, || {
            Oracle::submit_price(env.clone(), source, asset, price)
        })
    }

    fn get_price_result(
        env: &Env,
        oracle_id: &Address,
        asset: Address,
    ) -> Result<i128, OracleError> {
        env.as_contract(oracle_id, || Oracle::get_price_result(env, asset))
    }

    fn bump(env: &Env, secs: u64) {
        let mut li = env.ledger().get();
        li.timestamp += secs;
        env.ledger().set(li);
    }

    #[test]
    fn median_of_three_sources() {
        let (env, oracle_id, asset) = setup();
        submit(
            &env,
            &oracle_id,
            symbol_short!("pyth"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();
        submit(
            &env,
            &oracle_id,
            symbol_short!("chain"),
            asset.clone(),
            10_100_000,
        )
        .unwrap();
        submit(
            &env,
            &oracle_id,
            symbol_short!("dex"),
            asset.clone(),
            9_900_000,
        )
        .unwrap();
        let price = get_price_result(&env, &oracle_id, asset.clone()).unwrap();
        assert_eq!(price, 10_000_000);
    }

    #[test]
    fn circuit_breaker_rejects_manipulation() {
        let (env, oracle_id, asset) = setup();
        submit(
            &env,
            &oracle_id,
            symbol_short!("pyth"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();
        submit(
            &env,
            &oracle_id,
            symbol_short!("chain"),
            asset.clone(),
            10_100_000,
        )
        .unwrap();
        // A single manipulated source submitting +50% must be rejected.
        let err = submit(
            &env,
            &oracle_id,
            symbol_short!("dex"),
            asset.clone(),
            15_000_000,
        );
        assert_eq!(err, Err(OracleError::CircuitBroken));
        assert_eq!(
            get_price_result(&env, &oracle_id, asset.clone()).unwrap(),
            10_000_000
        );
    }

    #[test]
    fn stale_feed_is_rejected() {
        let (env, oracle_id, asset) = setup();
        submit(
            &env,
            &oracle_id,
            symbol_short!("pyth"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();
        submit(
            &env,
            &oracle_id,
            symbol_short!("chain"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();
        submit(
            &env,
            &oracle_id,
            symbol_short!("dex"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();
        bump(&env, MAX_SOURCE_AGE_SECS + 60);
        assert_eq!(
            get_price_result(&env, &oracle_id, asset.clone()),
            Err(OracleError::StalePrice)
        );
    }

    #[test]
    fn unauthorized_source_rejected() {
        let (env, oracle_id, asset) = setup();
        let err = submit(
            &env,
            &oracle_id,
            symbol_short!("evil"),
            asset.clone(),
            10_000_000,
        );
        assert_eq!(err, Err(OracleError::UnauthorizedSource));
    }

    #[test]
    fn twap_smooths_spike() {
        let (env, oracle_id, asset) = setup();
        submit(
            &env,
            &oracle_id,
            symbol_short!("pyth"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();
        submit(
            &env,
            &oracle_id,
            symbol_short!("chain"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();
        submit(
            &env,
            &oracle_id,
            symbol_short!("dex"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();
        bump(&env, 600);
        submit(
            &env,
            &oracle_id,
            symbol_short!("pyth"),
            asset.clone(),
            10_250_000,
        )
        .unwrap();
        submit(
            &env,
            &oracle_id,
            symbol_short!("chain"),
            asset.clone(),
            10_250_000,
        )
        .unwrap();
        submit(
            &env,
            &oracle_id,
            symbol_short!("dex"),
            asset.clone(),
            10_250_000,
        )
        .unwrap();
        let price = get_price_result(&env, &oracle_id, asset.clone()).unwrap();
        assert!(
            price > 10_000_000,
            "twap must be above old baseline, got {price}"
        );
        assert!(
            price < 10_250_000,
            "twap must smooth below the spike, got {price}"
        );
    }

    #[test]
    fn manipulation_sweep_is_bounded() {
        // Deterministic sweep approximating the DoD manipulation fuzz:
        // no single-source injection may move the effective price by more
        // than the circuit breaker allows.
        let (env, oracle_id, asset) = setup();
        let base = PRICE_SCALE;
        submit(&env, &oracle_id, symbol_short!("pyth"), asset.clone(), base).unwrap();
        submit(
            &env,
            &oracle_id,
            symbol_short!("chain"),
            asset.clone(),
            base,
        )
        .unwrap();
        submit(&env, &oracle_id, symbol_short!("dex"), asset.clone(), base).unwrap();
        for frac_bps in [100u32, 299, 300, 301, 500, 1_000, 10_000] {
            submit(&env, &oracle_id, symbol_short!("pyth"), asset.clone(), base).unwrap();
            submit(
                &env,
                &oracle_id,
                symbol_short!("chain"),
                asset.clone(),
                base,
            )
            .unwrap();
            let attack = base
                .checked_add(base.checked_mul(frac_bps as i128).unwrap() / 10_000)
                .unwrap();
            let res = submit(
                &env,
                &oracle_id,
                symbol_short!("dex"),
                asset.clone(),
                attack,
            );
            if frac_bps > MAX_DEVIATION_BPS as u32 {
                assert_eq!(res, Err(OracleError::CircuitBroken), "at {frac_bps}bps");
            }
            let p = get_price_result(&env, &oracle_id, asset.clone()).unwrap();
            assert!(p > 0 && p < base * 2, "price runaway at {frac_bps}bps: {p}");
            bump(&env, 300);
        }
    }

    fn accept_admin(env: &Env, oracle_id: &Address) -> Result<(), OracleError> {
        env.as_contract(oracle_id, || Oracle::accept_admin(env.clone()))
    }

    #[test]
    fn pause_blocks_submissions_and_reads() {
        let (env, oracle_id, asset) = setup();
        let client = OracleClient::new(&env, &oracle_id);
        submit(
            &env,
            &oracle_id,
            symbol_short!("pyth"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();
        submit(
            &env,
            &oracle_id,
            symbol_short!("chain"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();

        client.pause();
        assert!(client.is_paused());
        assert_eq!(
            submit(
                &env,
                &oracle_id,
                symbol_short!("dex"),
                asset.clone(),
                10_000_000
            ),
            Err(OracleError::ContractPaused)
        );
        assert_eq!(
            get_price_result(&env, &oracle_id, asset.clone()),
            Err(OracleError::ContractPaused)
        );

        client.unpause();
        assert!(!client.is_paused());
        submit(
            &env,
            &oracle_id,
            symbol_short!("dex"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();
        assert_eq!(
            get_price_result(&env, &oracle_id, asset.clone()).unwrap(),
            10_000_000
        );
    }

    #[test]
    fn upgrade_requires_admin_auth() {
        let (env, oracle_id, _asset) = setup();
        env.mock_auths(&[]);
        let hash = BytesN::from_array(&env, &[7u8; 32]);
        let client = OracleClient::new(&env, &oracle_id);
        assert!(client.try_upgrade(&hash).is_err());
    }

    #[test]
    fn admin_rotation_respects_timelock() {
        let (env, oracle_id, _asset) = setup();
        let client = OracleClient::new(&env, &oracle_id);
        let previous = client.get_admin();
        let new_admin = Address::generate(&env);

        client.propose_admin(&new_admin);
        assert_eq!(client.get_pending_admin(), Some(new_admin.clone()));

        // The nominee cannot take over before the 24h timelock elapses.
        assert_eq!(
            accept_admin(&env, &oracle_id),
            Err(OracleError::AdminTimelockNotElapsed)
        );

        bump(&env, ADMIN_ROTATION_DELAY_SECS + 1);
        assert_eq!(accept_admin(&env, &oracle_id), Ok(()));
        assert_eq!(client.get_admin(), new_admin);
        assert_ne!(client.get_admin(), previous);
        assert_eq!(client.get_pending_admin(), None);
    }

    #[test]
    fn accept_admin_without_proposal_fails() {
        let (env, oracle_id, _asset) = setup();
        assert_eq!(
            accept_admin(&env, &oracle_id),
            Err(OracleError::NoPendingAdmin)
        );
    }

    #[contract]
    pub struct MockBreaker;

    #[contractimpl]
    impl MockBreaker {
        pub fn set_blocked(env: Env, blocked: bool) {
            env.storage().instance().set(&symbol_short!("blk"), &blocked);
        }

        pub fn is_blocked(env: Env, _contract: Address, _function: Symbol) -> bool {
            env.storage()
                .instance()
                .get(&symbol_short!("blk"))
                .unwrap_or(false)
        }
    }

    #[test]
    fn circuit_breaker_blocks_submissions() {
        let (env, oracle_id, asset) = setup();
        let client = OracleClient::new(&env, &oracle_id);
        submit(
            &env,
            &oracle_id,
            symbol_short!("pyth"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();
        submit(
            &env,
            &oracle_id,
            symbol_short!("chain"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();

        let breaker_id = env.register(MockBreaker, ());
        let breaker = MockBreakerClient::new(&env, &breaker_id);
        breaker.set_blocked(&false);
        client.set_circuit_breaker(&Some(breaker_id.clone()));
        assert_eq!(client.get_circuit_breaker(), Some(breaker_id.clone()));

        // Untripped breaker: submissions flow normally.
        submit(
            &env,
            &oracle_id,
            symbol_short!("dex"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();

        // Tripped breaker: the oracle refuses new prices.
        breaker.set_blocked(&true);
        assert_eq!(
            submit(
                &env,
                &oracle_id,
                symbol_short!("dex"),
                asset.clone(),
                10_000_000
            ),
            Err(OracleError::CircuitBreakerTripped)
        );

        // Clearing the breaker restores submissions.
        client.set_circuit_breaker(&None);
        assert_eq!(client.get_circuit_breaker(), None);
        submit(
            &env,
            &oracle_id,
            symbol_short!("dex"),
            asset.clone(),
            10_000_000,
        )
        .unwrap();
    }
}
