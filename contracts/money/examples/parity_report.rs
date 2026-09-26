//! Cross-language money-policy parity report (issue #432).
//!
//! Prints one result line per case so `scripts/money-parity.ts` can compare the
//! on-chain `money` crate against `backend/src/money/decimal.ts` over the same
//! inputs. This is a CI/test driver only: it is not part of any contract's
//! footprint and adds nothing to the compiled WASM.
//!
//! Cases are given either as argv, or — when invoked with no arguments — one per
//! line on stdin, which is how `scripts/money-parity.ts` feeds large randomized
//! batches without running into the OS argument-list limit.
//!
//! Usage, from the repository root:
//!
//! ```text
//! cargo run -p money --example parity_report -- \
//!   round_div:7:2:half_even split_pro_rata:100:1,1,1 derived:compute_fee:100000000:250
//! printf 'round_div:7:2:half_even\n' | cargo run -p money --example parity_report
//! ```
//!
//! Output is one line per case, in input order:
//!
//! ```text
//! ok 3
//! ok 34,33,33
//! err div_by_zero
//! ```
//!
//! The `derived:` cases are the stroop reductions the policy's money operations
//! bottom out in — `compute_fee`, `calculate_interest` and `round_amount` — so
//! the fee/interest/rounding vectors have a name on both sides of the harness
//! without inventing a second production API next to the contract's `round_div`.

use std::io::Read;

use money::{round_div, split_pro_rata, MathError, RoundingMode};
use soroban_sdk::{Env, Vec as SdkVec};

/// Basis points in one whole unit (`100%` == `10_000` bps).
const BPS_DENOMINATOR: i128 = 10_000;
/// Days used to annualize a rate (`annual_rate_bps / 10_000 / 365` per day).
const DAYS_PER_YEAR: i128 = 365;
/// Stroops per displayed cent (`10^(scale - display_dp)` == `10^5`).
const STROOPS_PER_CENT: i128 = 100_000;

fn parse_mode(raw: &str) -> Option<RoundingMode> {
    match raw {
        "half_even" => Some(RoundingMode::HalfEven),
        "half_up" => Some(RoundingMode::HalfUp),
        "floor" => Some(RoundingMode::Floor),
        "ceil" => Some(RoundingMode::Ceil),
        _ => None,
    }
}

fn error_code(err: MathError) -> &'static str {
    match err {
        MathError::Overflow => "overflow",
        MathError::DivByZero => "div_by_zero",
        MathError::DriftDetected => "drift_detected",
    }
}

fn render_div(num: i128, den: i128, mode: RoundingMode) -> String {
    match round_div(num, den, mode) {
        Ok(value) => format!("ok {value}"),
        Err(err) => format!("err {}", error_code(err)),
    }
}

/// `round_div(product, denominator, HalfEven)` for a checked product.
fn render_half_even_ratio(product: Option<i128>, denominator: i128) -> String {
    match product {
        Some(product) => render_div(product, denominator, RoundingMode::HalfEven),
        None => "err overflow".to_string(),
    }
}

fn run_case(case: &str) -> String {
    let parts: std::vec::Vec<&str> = case.split(':').collect();
    match parts.first().copied() {
        Some("round_div") if parts.len() == 4 => {
            let (Ok(num), Ok(den), Some(mode)) = (
                parts[1].parse::<i128>(),
                parts[2].parse::<i128>(),
                parse_mode(parts[3]),
            ) else {
                return "err bad_input".to_string();
            };
            render_div(num, den, mode)
        }
        Some("split_pro_rata") if parts.len() == 3 => {
            let Ok(total) = parts[1].parse::<i128>() else {
                return "err bad_input".to_string();
            };
            let parsed: Option<std::vec::Vec<i128>> = parts[2]
                .split(',')
                .map(|w| w.parse::<i128>().ok())
                .collect();
            let Some(weights) = parsed else {
                return "err bad_input".to_string();
            };
            let env = Env::default();
            match split_pro_rata(&env, total, &SdkVec::from_slice(&env, &weights)) {
                Ok(parts) => {
                    let rendered: std::vec::Vec<String> =
                        parts.iter().map(|p| p.to_string()).collect();
                    format!("ok {}", rendered.join(","))
                }
                Err(err) => format!("err {}", error_code(err)),
            }
        }
        // Fee: `principal * rate_bps / 10_000`, half-even.
        Some("derived") if parts.len() == 4 && parts[1] == "compute_fee" => {
            let (Ok(principal), Ok(rate_bps)) =
                (parts[2].parse::<i128>(), parts[3].parse::<i128>())
            else {
                return "err bad_input".to_string();
            };
            render_half_even_ratio(principal.checked_mul(rate_bps), BPS_DENOMINATOR)
        }
        // Simple interest: `principal * rate_bps * days / (10_000 * 365)`, half-even.
        Some("derived") if parts.len() == 5 && parts[1] == "calculate_interest" => {
            let (Ok(principal), Ok(rate_bps), Ok(days)) = (
                parts[2].parse::<i128>(),
                parts[3].parse::<i128>(),
                parts[4].parse::<i128>(),
            ) else {
                return "err bad_input".to_string();
            };
            let product = principal
                .checked_mul(rate_bps)
                .and_then(|n| n.checked_mul(days));
            match BPS_DENOMINATOR.checked_mul(DAYS_PER_YEAR) {
                Some(denom) => render_half_even_ratio(product, denom),
                None => "err overflow".to_string(),
            }
        }
        // Display rounding: quantize to `display_dp` (2) at stroop scale.
        Some("derived") if parts.len() == 3 && parts[1] == "round_amount" => {
            let Ok(stroops) = parts[2].parse::<i128>() else {
                return "err bad_input".to_string();
            };
            match round_div(stroops, STROOPS_PER_CENT, RoundingMode::HalfEven) {
                Ok(cents) => match cents.checked_mul(STROOPS_PER_CENT) {
                    Some(value) => format!("ok {value}"),
                    None => "err overflow".to_string(),
                },
                Err(err) => format!("err {}", error_code(err)),
            }
        }
        _ => "err bad_input".to_string(),
    }
}

fn main() {
    let argv: std::vec::Vec<String> = std::env::args().skip(1).collect();
    if !argv.is_empty() {
        for raw in argv {
            println!("{}", run_case(&raw));
        }
        return;
    }

    let mut stdin = String::new();
    std::io::stdin()
        .read_to_string(&mut stdin)
        .expect("reading cases from stdin");
    for raw in stdin.lines().filter(|line| !line.is_empty()) {
        println!("{}", run_case(raw));
    }
}
