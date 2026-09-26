//! Money-policy parity tests against the off-chain implementation (issue #432).
//!
//! `contracts/money` and `backend/src/money/decimal.ts` are two implementations
//! of one policy — `money-policy.json` fixes the scale, rounding mode, display
//! precision and allocation strategy they must agree on, and both layers must
//! produce byte-identical results for the same stroop amount, or the off-chain
//! settlement path can disagree with what the chain actually settles. Until now
//! nothing checked that: this crate's unit tests pinned a handful of examples
//! without any cross-language counterpart.
//!
//! This file is the Rust half of the harness. It asserts:
//!
//!   1. the shared vectors from `tests/money-parity/vectors.json` (the same
//!      table `backend/src/money/__tests__/parity-vectors.test.ts` asserts),
//!   2. rounding results against the *definition* of each mode rather than
//!      against a second implementation of the same algorithm, over an
//!      exhaustive small domain plus a remainder sweep that hits every tie,
//!   3. the `split_pro_rata` invariants under randomized input.
//!
//! The remaining shared vectors — malformed case strings, which live in the
//! runner's case format rather than the kernel API, and the `compute_fee` /
//! `calculate_interest` / `round_amount` reductions — are replayed through this
//! crate by `scripts/money-parity.ts`, which also diffs every case against
//! `decimal.ts` and fails the build on any divergence.

use money::{round_div, split_pro_rata, MathError, RoundingMode, STROOP_SCALE};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use soroban_sdk::{Env, Vec};

const MODES: [RoundingMode; 4] = [
    RoundingMode::HalfEven,
    RoundingMode::HalfUp,
    RoundingMode::Floor,
    RoundingMode::Ceil,
];

/// `num`, `den`, `mode`, expected result.
type RoundingVector = (i128, i128, RoundingMode, i128);
/// `total`, weights, expected parts.
type SplitVector<'a> = (i128, &'a [i128], &'a [i128]);

fn v(env: &Env, xs: &[i128]) -> Vec<i128> {
    Vec::from_slice(env, xs)
}

// ── Shared vectors (tests/money-parity/vectors.json) ────────────────────────

/// Rounding vectors: exact division, below/at/above the half-way point, both
/// signs, a negative denominator, sub-unit magnitudes, and settlement-scale
/// values where a silent float cast would already have lost precision.
#[test]
fn shared_rounding_vectors_hold() {
    let cases: &[RoundingVector] = &[
        (7, 2, RoundingMode::Floor, 3),
        (-7, 2, RoundingMode::Floor, -4),
        (7, 2, RoundingMode::Ceil, 4),
        (-7, 2, RoundingMode::Ceil, -3),
        (6, 2, RoundingMode::HalfEven, 3),
        (10, 5, RoundingMode::Ceil, 2),
        (0, 7, RoundingMode::HalfEven, 0),
        (5, 2, RoundingMode::HalfEven, 2),
        (7, 2, RoundingMode::HalfEven, 4),
        (9, 2, RoundingMode::HalfEven, 4),
        (3, 2, RoundingMode::HalfEven, 2),
        (1, 2, RoundingMode::HalfEven, 0),
        (-5, 2, RoundingMode::HalfEven, -2),
        (-7, 2, RoundingMode::HalfEven, -4),
        (7, -2, RoundingMode::HalfEven, -4),
        (-7, -2, RoundingMode::HalfEven, 4),
        (5, 2, RoundingMode::HalfUp, 3),
        (-5, 2, RoundingMode::HalfUp, -3),
        (1, 4, RoundingMode::HalfUp, 0),
        (3, 4, RoundingMode::HalfUp, 1),
        (-1, 3, RoundingMode::HalfEven, 0),
        (-1, 3, RoundingMode::Floor, -1),
        (-1, 3, RoundingMode::Ceil, 0),
        (1, 3, RoundingMode::Floor, 0),
        (1, 3, RoundingMode::Ceil, 1),
        (2, 3, RoundingMode::HalfEven, 1),
        (4, 3, RoundingMode::HalfEven, 1),
        (5, 3, RoundingMode::HalfEven, 2),
        (123_456_789, 1_000, RoundingMode::HalfEven, 123_457),
        (1_000_000_007, 3, RoundingMode::HalfEven, 333_333_336),
        (1_000_000_006, 3, RoundingMode::HalfEven, 333_333_335),
        (
            999_999_999_999_999_999,
            7,
            RoundingMode::HalfEven,
            142_857_142_857_142_857,
        ),
        (
            -999_999_999_999_999_999,
            7,
            RoundingMode::HalfEven,
            -142_857_142_857_142_857,
        ),
    ];

    for &(num, den, mode, expected) in cases {
        assert_eq!(
            round_div(num, den, mode),
            Ok(expected),
            "round_div({num}, {den}, {mode:?}) must be {expected}"
        );
    }

    assert_eq!(
        round_div(5, 0, RoundingMode::HalfEven),
        Err(MathError::DivByZero)
    );
    assert_eq!(
        round_div(0, 0, RoundingMode::Floor),
        Err(MathError::DivByZero)
    );
}

/// Largest-remainder vectors: parts must sum exactly to the total, and a tie in
/// the fractional remainder goes to the lowest index.
#[test]
fn shared_split_vectors_hold() {
    let env = Env::default();
    let cases: &[SplitVector] = &[
        (100, &[1, 1, 1], &[34, 33, 33]),
        (101, &[1, 1, 1], &[34, 34, 33]),
        (
            1_000_000_007,
            &[3, 5, 7, 11],
            &[115_384_616, 192_307_694, 269_230_771, 423_076_926],
        ),
        (7, &[1, 1, 1, 1, 1, 1, 1], &[1, 1, 1, 1, 1, 1, 1]),
        (0, &[1, 2, 3], &[0, 0, 0]),
        (1, &[1], &[1]),
        (
            10_000_000,
            &[333, 333, 334],
            &[3_330_000, 3_330_000, 3_340_000],
        ),
        (999, &[2, 3, 5], &[200, 300, 499]),
        (
            123_456_789,
            &[1, 2, 3, 4, 5, 6],
            &[
                5_878_895, 11_757_789, 17_636_684, 23_515_579, 29_394_474, 35_273_368,
            ],
        ),
        (0, &[0, 0], &[0, 0]),
        (5, &[10, 0], &[5, 0]),
        (1_000, &[1, 0, 0], &[1_000, 0, 0]),
    ];

    for &(total, weights, expected) in cases {
        let parts = split_pro_rata(&env, total, &v(&env, weights)).unwrap();
        let got: std::vec::Vec<i128> = parts.iter().collect();
        assert_eq!(
            got, expected,
            "split_pro_rata({total}, {weights:?}) must match the shared vector"
        );
        assert_eq!(parts.iter().sum::<i128>(), total, "parts must sum exactly");
    }

    // A zero weight-sum, or a negative weight, is drift rather than a silently
    // skewed allocation.
    assert_eq!(
        split_pro_rata(&env, 100, &v(&env, &[0, 0, 0])),
        Err(MathError::DriftDetected)
    );
    assert_eq!(
        split_pro_rata(&env, 1, &v(&env, &[0, 0])),
        Err(MathError::DriftDetected)
    );
    assert_eq!(
        split_pro_rata(&env, 100, &v(&env, &[1, -1])),
        Err(MathError::DriftDetected)
    );
}

// ── Independent property checks ─────────────────────────────────────────────

/// Assert `got` is the unique legal rounding of `num / den` under `mode`,
/// derived from each mode's definition (bounds plus tie rule) instead of from a
/// second implementation of the same algorithm.
fn assert_is_legal_rounding(num: i128, den: i128, mode: RoundingMode, got: i128) {
    assert_ne!(den, 0, "the reference only applies to nonzero denominators");
    let (num, den) = if den < 0 { (-num, -den) } else { (num, den) };

    let scaled = got
        .checked_mul(den)
        .expect("the scaled result must fit in i128");
    let distance = (scaled - num).abs();

    match mode {
        RoundingMode::Floor => {
            assert!(
                scaled <= num,
                "floor must not overshoot: {got} of {num}/{den}"
            );
            assert!(
                scaled + den > num,
                "floor must be the greatest integer below: {got} of {num}/{den}"
            );
        }
        RoundingMode::Ceil => {
            assert!(
                scaled >= num,
                "ceil must not undershoot: {got} of {num}/{den}"
            );
            assert!(
                scaled - den < num,
                "ceil must be the least integer above: {got} of {num}/{den}"
            );
        }
        RoundingMode::HalfUp => {
            assert!(
                2 * distance <= den,
                "half_up must stay within half a unit: {got} of {num}/{den}"
            );
            if 2 * distance == den {
                // An exact tie rounds away from zero: up for a positive
                // quotient, down for a negative one.
                let tie_expected = if num > 0 {
                    num / den + 1
                } else {
                    num / den - 1
                };
                assert_eq!(
                    got, tie_expected,
                    "half_up ties must resolve away from zero: {num}/{den}"
                );
            }
        }
        RoundingMode::HalfEven => {
            assert!(
                2 * distance <= den,
                "half_even must stay within half a unit: {got} of {num}/{den}"
            );
            if 2 * distance == den {
                assert_eq!(
                    got % 2,
                    0,
                    "an exact half-even tie must land on an even integer: {got} of {num}/{den}"
                );
            }
        }
    }
}

/// Exhaustive small-domain check of every rounding mode against the definition.
#[test]
fn round_div_matches_its_definition_on_a_small_domain() {
    for num in -60i128..=60 {
        for den in -20i128..=20 {
            if den == 0 {
                assert_eq!(
                    round_div(num, den, RoundingMode::Floor),
                    Err(MathError::DivByZero)
                );
                continue;
            }
            for mode in MODES {
                let got = round_div(num, den, mode).expect("a nonzero denominator");
                assert_is_legal_rounding(num, den, mode, got);
            }
        }
    }
}

/// Remainder sweep: for every remainder at every quotient parity, `half_even`
/// must land on the even side of an exact tie, and the two half modes must agree
/// everywhere else — the tie is the only place they are allowed to differ.
#[test]
fn half_modes_agree_away_from_exact_ties() {
    for den in 2i128..=41 {
        for quotient in 0i128..=20 {
            for offset in 0..den {
                let num = quotient * den + offset;

                let half_even = round_div(num, den, RoundingMode::HalfEven).unwrap();
                let half_up = round_div(num, den, RoundingMode::HalfUp).unwrap();
                assert_is_legal_rounding(num, den, RoundingMode::HalfEven, half_even);
                assert_is_legal_rounding(num, den, RoundingMode::HalfUp, half_up);

                if offset * 2 == den {
                    assert_eq!(
                        half_even % 2,
                        0,
                        "tie {num}/{den} must round to the even quotient, got {half_even}"
                    );
                } else {
                    assert_eq!(
                        half_even, half_up,
                        "away from a tie the half modes must agree on {num}/{den}"
                    );
                }
            }
        }
    }
}

/// `split_pro_rata` invariants under randomized input: exact sum, and the
/// largest-remainder property that every part sits at its floor share or one
/// unit above it.
#[test]
fn split_pro_rata_invariants_hold_randomized() {
    let mut rng = StdRng::seed_from_u64(0x432_432_432_432);

    for _ in 0..500 {
        // Fresh env per iteration: the test host meters a budget per `Env`, and
        // reusing one across hundreds of Vec operations would exceed it even
        // though each individual allocation is tiny.
        let env = Env::default();
        let n = rng.gen_range(1..=10u32);
        let total: i128 = rng.gen_range(0..=1_000_000_000_000i128);
        let weights: Vec<i128> = {
            let mut w = Vec::new(&env);
            for _ in 0..n {
                w.push_back(rng.gen_range(0..=1_000_000i128));
            }
            w
        };

        let weight_sum: i128 = weights.iter().sum();
        if weight_sum == 0 {
            // Covered by the zero-weight-sum case above.
            continue;
        }

        let parts = split_pro_rata(&env, total, &weights).unwrap();
        assert_eq!(parts.len(), weights.len());
        assert_eq!(parts.iter().sum::<i128>(), total, "parts must sum exactly");

        let mut allocated = 0i128;
        for (i, part) in parts.iter().enumerate() {
            let weight = weights.get(i as u32).unwrap();
            let floor = total * weight / weight_sum;
            assert!(
                part >= floor,
                "no part may sit below its floor share ({part} < {floor})"
            );
            assert!(
                part <= floor + 1,
                "no part may sit more than one unit above its floor share ({part} > {floor})"
            );
            allocated += part;
        }
        assert_eq!(allocated, total);
    }
}

/// The split must be reproducible: identical inputs, identical parts.
#[test]
fn split_pro_rata_is_deterministic() {
    let env = Env::default();
    let weights = v(&env, &[3, 5, 7, 11]);
    let first = split_pro_rata(&env, 1_000_000_007, &weights).unwrap();
    let second = split_pro_rata(&env, 1_000_000_007, &weights).unwrap();
    assert_eq!(
        first.iter().collect::<std::vec::Vec<i128>>(),
        second.iter().collect::<std::vec::Vec<i128>>()
    );
}

/// The generated policy module and the hand-authored kernel must agree on the
/// scale both layers convert against.
#[test]
fn stroop_scale_matches_the_policy() {
    assert_eq!(STROOP_SCALE, 10_000_000);
    assert_eq!(round_div(1, STROOP_SCALE, RoundingMode::HalfEven), Ok(0));
    assert_eq!(
        round_div(STROOP_SCALE, 1, RoundingMode::HalfEven),
        Ok(STROOP_SCALE)
    );
}
