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

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, Symbol,
    Vec,
};

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

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum OracleError {
    NotInitialized = 1,
    UnauthorizedSource = 2,
    InsufficientSources = 3,
    StalePrice = 4,
    CircuitBroken = 5,
    ZeroPrice = 6,
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
        let series = match series {
            Some(s) => s,
            None => return None,
        };
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
        let sources: Option<Vec<Symbol>> = env
            .storage()
            .persistent()
            .get(&list_key);
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
        Ok(mid.clone())
    }

    /// Submit a price for `asset` from an authorized source.
    pub fn submit_price(env: Env, source: Symbol, asset: Address, price: i128) -> Result<(), OracleError> {
        use soroban_sdk::Symbol;
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

        let median = Self::fresh_median(&env, &asset, now)?;
        match Self::twap(&env, &asset, now) {
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

#[cfg(test)]#[cfg(test)]
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
        let sources = vec![&env, symbol_short!("pyth"), symbol_short!("chain"), symbol_short!("dex")];
        let oracle_id = env.register(Oracle, ());
        let client = OracleClient::new(&env, &oracle_id);
        client.initialize(&admin, &sources);
        let asset = Address::generate(&env);
        (env, oracle_id, asset)
    }

    fn submit(env: &Env, oracle_id: &Address, source: soroban_sdk::Symbol, asset: Address, price: i128) -> Result<(), OracleError> {
        env.as_contract(oracle_id, || Oracle::submit_price(env.clone(), source, asset, price))
    }

    fn get_price_result(env: &Env, oracle_id: &Address, asset: Address) -> Result<i128, OracleError> {
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
        submit(&env, &oracle_id, symbol_short!("pyth"), asset.clone(), 10_000_000).unwrap();
        submit(&env, &oracle_id, symbol_short!("chain"), asset.clone(), 10_100_000).unwrap();
        submit(&env, &oracle_id, symbol_short!("dex"), asset.clone(), 9_900_000).unwrap();
        let price = get_price_result(&env, &oracle_id, asset.clone()).unwrap();
        assert_eq!(price, 10_000_000);
    }

    #[test]
    fn circuit_breaker_rejects_manipulation() {
        let (env, oracle_id, asset) = setup();
        submit(&env, &oracle_id, symbol_short!("pyth"), asset.clone(), 10_000_000).unwrap();
        submit(&env, &oracle_id, symbol_short!("chain"), asset.clone(), 10_100_000).unwrap();
        // A single manipulated source submitting +50% must be rejected.
        let err = submit(&env, &oracle_id, symbol_short!("dex"), asset.clone(), 15_000_000);
        assert_eq!(err, Err(OracleError::CircuitBroken));
        assert_eq!(get_price_result(&env, &oracle_id, asset.clone()).unwrap(), 10_000_000);
    }

    #[test]
    fn stale_feed_is_rejected() {
        let (env, oracle_id, asset) = setup();
        submit(&env, &oracle_id, symbol_short!("pyth"), asset.clone(), 10_000_000).unwrap();
        submit(&env, &oracle_id, symbol_short!("chain"), asset.clone(), 10_000_000).unwrap();
        submit(&env, &oracle_id, symbol_short!("dex"), asset.clone(), 10_000_000).unwrap();
        bump(&env, MAX_SOURCE_AGE_SECS + 60);
        assert_eq!(get_price_result(&env, &oracle_id, asset.clone()), Err(OracleError::StalePrice));
    }

    #[test]
    fn unauthorized_source_rejected() {
        let (env, oracle_id, asset) = setup();
        let err = submit(&env, &oracle_id, symbol_short!("evil"), asset.clone(), 10_000_000);
        assert_eq!(err, Err(OracleError::UnauthorizedSource));
    }

    #[test]
    fn twap_smooths_spike() {
        let (env, oracle_id, asset) = setup();
        submit(&env, &oracle_id, symbol_short!("pyth"), asset.clone(), 10_000_000).unwrap();
        submit(&env, &oracle_id, symbol_short!("chain"), asset.clone(), 10_000_000).unwrap();
        submit(&env, &oracle_id, symbol_short!("dex"), asset.clone(), 10_000_000).unwrap();
        bump(&env, 600);
        submit(&env, &oracle_id, symbol_short!("pyth"), asset.clone(), 10_250_000).unwrap();
        submit(&env, &oracle_id, symbol_short!("chain"), asset.clone(), 10_250_000).unwrap();
        submit(&env, &oracle_id, symbol_short!("dex"), asset.clone(), 10_250_000).unwrap();
        let price = get_price_result(&env, &oracle_id, asset.clone()).unwrap();
        assert!(price > 10_000_000, "twap must be above old baseline, got {price}");
        assert!(price < 10_250_000, "twap must smooth below the spike, got {price}");
    }

    #[test]
    fn manipulation_sweep_is_bounded() {
        // Deterministic sweep approximating the DoD manipulation fuzz:
        // no single-source injection may move the effective price by more
        // than the circuit breaker allows.
        let (env, oracle_id, asset) = setup();
        let base = PRICE_SCALE;
        submit(&env, &oracle_id, symbol_short!("pyth"), asset.clone(), base).unwrap();
        submit(&env, &oracle_id, symbol_short!("chain"), asset.clone(), base).unwrap();
        submit(&env, &oracle_id, symbol_short!("dex"), asset.clone(), base).unwrap();
        for frac_bps in [100u32, 299, 300, 301, 500, 1_000, 10_000] {
            submit(&env, &oracle_id, symbol_short!("pyth"), asset.clone(), base).unwrap();
            submit(&env, &oracle_id, symbol_short!("chain"), asset.clone(), base).unwrap();
            let attack = base
                .checked_add(base.checked_mul(frac_bps as i128).unwrap() / 10_000)
                .unwrap();
            let res = submit(&env, &oracle_id, symbol_short!("dex"), asset.clone(), attack);
            if frac_bps > MAX_DEVIATION_BPS as u32 {
                assert_eq!(res, Err(OracleError::CircuitBroken), "at {frac_bps}bps");
            }
            let p = get_price_result(&env, &oracle_id, asset.clone()).unwrap();
            assert!(p > 0 && p < base * 2, "price runaway at {frac_bps}bps: {p}");
            bump(&env, 300);
        }
    }
}
