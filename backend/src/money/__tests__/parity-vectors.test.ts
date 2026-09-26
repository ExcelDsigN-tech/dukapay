import fc from 'fast-check';
import {
  DEFAULT_MODE,
  DISPLAY_DECIMAL_PLACES,
  MoneyError,
  RoundingMode,
  roundDiv,
  splitProRata,
  STROOP_DECIMALS,
  STROOP_SCALE,
} from '../decimal.js';

/**
 * Money-policy parity tests against the on-chain implementation (issue #432).
 *
 * `backend/src/money/decimal.ts` and `contracts/money` are two implementations
 * of one policy — `money-policy.json` fixes the scale, rounding mode, display
 * precision and allocation strategy they must both honour — so the two layers
 * have to produce byte-identical results for the same stroop amount, or the
 * off-chain settlement path can disagree with what the chain settles. Until now
 * nothing checked that: this file's sibling `decimal.test.ts` mirrors a handful
 * of the contract crate's fixtures, and no test ever executed both sides.
 *
 * This file asserts the shared vectors from `tests/money-parity/vectors.json`
 * (the same table `contracts/money/tests/parity_vectors.rs` asserts), checks
 * `roundDiv` against each mode's *definition* rather than a second copy of the
 * algorithm, and fuzzes `splitProRata` for the invariants the policy promises.
 *
 * The remaining shared vectors — malformed case strings, which live in the
 * runner's case format rather than this module's API, and the `compute_fee` /
 * `calculate_interest` / `round_amount` reductions — are replayed by
 * `scripts/money-parity.ts`, which diffs every case against the Rust kernel and
 * fails the build on any divergence.
 */

const MODES: RoundingMode[] = [
  RoundingMode.HalfEven,
  RoundingMode.HalfUp,
  RoundingMode.Floor,
  RoundingMode.Ceil,
];

/** `num`, `den`, `mode`, expected result. */
type RoundingVector = [bigint, bigint, RoundingMode, bigint];
/** `total`, weights, expected parts. */
type SplitVector = [bigint, bigint[], bigint[]];

// ── Shared vectors (tests/money-parity/vectors.json) ────────────────────────

describe('shared money-parity vectors', () => {
  // Rounding vectors: exact division, below/at/above the half-way point, both
  // signs, a negative denominator, sub-unit magnitudes, and settlement-scale
  // values where a silent float cast would already have lost precision.
  const rounding: RoundingVector[] = [
    [7n, 2n, RoundingMode.Floor, 3n],
    [-7n, 2n, RoundingMode.Floor, -4n],
    [7n, 2n, RoundingMode.Ceil, 4n],
    [-7n, 2n, RoundingMode.Ceil, -3n],
    [6n, 2n, RoundingMode.HalfEven, 3n],
    [10n, 5n, RoundingMode.Ceil, 2n],
    [0n, 7n, RoundingMode.HalfEven, 0n],
    [5n, 2n, RoundingMode.HalfEven, 2n],
    [7n, 2n, RoundingMode.HalfEven, 4n],
    [9n, 2n, RoundingMode.HalfEven, 4n],
    [3n, 2n, RoundingMode.HalfEven, 2n],
    [1n, 2n, RoundingMode.HalfEven, 0n],
    [-5n, 2n, RoundingMode.HalfEven, -2n],
    [-7n, 2n, RoundingMode.HalfEven, -4n],
    [7n, -2n, RoundingMode.HalfEven, -4n],
    [-7n, -2n, RoundingMode.HalfEven, 4n],
    [5n, 2n, RoundingMode.HalfUp, 3n],
    [-5n, 2n, RoundingMode.HalfUp, -3n],
    [1n, 4n, RoundingMode.HalfUp, 0n],
    [3n, 4n, RoundingMode.HalfUp, 1n],
    [-1n, 3n, RoundingMode.HalfEven, 0n],
    [-1n, 3n, RoundingMode.Floor, -1n],
    [-1n, 3n, RoundingMode.Ceil, 0n],
    [1n, 3n, RoundingMode.Floor, 0n],
    [1n, 3n, RoundingMode.Ceil, 1n],
    [2n, 3n, RoundingMode.HalfEven, 1n],
    [4n, 3n, RoundingMode.HalfEven, 1n],
    [5n, 3n, RoundingMode.HalfEven, 2n],
    [123456789n, 1000n, RoundingMode.HalfEven, 123457n],
    [1000000007n, 3n, RoundingMode.HalfEven, 333333336n],
    [1000000006n, 3n, RoundingMode.HalfEven, 333333335n],
    [999999999999999999n, 7n, RoundingMode.HalfEven, 142857142857142857n],
    [-999999999999999999n, 7n, RoundingMode.HalfEven, -142857142857142857n],
  ];

  it('rounds exactly like contracts/money does', () => {
    for (const [num, den, mode, expected] of rounding) {
      expect(roundDiv(num, den, mode)).toBe(expected);
    }
  });

  it('rejects a zero denominator with the same error class', () => {
    expect(() => roundDiv(5n, 0n, RoundingMode.HalfEven)).toThrow(MoneyError);
    expect(() => roundDiv(0n, 0n, RoundingMode.Floor)).toThrow(MoneyError);
  });

  // Largest-remainder vectors: parts must sum exactly to the total, and a tie in
  // the fractional remainder goes to the lowest index.
  const splits: SplitVector[] = [
    [100n, [1n, 1n, 1n], [34n, 33n, 33n]],
    [101n, [1n, 1n, 1n], [34n, 34n, 33n]],
    [1000000007n, [3n, 5n, 7n, 11n], [115384616n, 192307694n, 269230771n, 423076926n]],
    [7n, [1n, 1n, 1n, 1n, 1n, 1n, 1n], [1n, 1n, 1n, 1n, 1n, 1n, 1n]],
    [0n, [1n, 2n, 3n], [0n, 0n, 0n]],
    [1n, [1n], [1n]],
    [10000000n, [333n, 333n, 334n], [3330000n, 3330000n, 3340000n]],
    [999n, [2n, 3n, 5n], [200n, 300n, 499n]],
    [
      123456789n,
      [1n, 2n, 3n, 4n, 5n, 6n],
      [5878895n, 11757789n, 17636684n, 23515579n, 29394474n, 35273368n],
    ],
    [0n, [0n, 0n], [0n, 0n]],
    [5n, [10n, 0n], [5n, 0n]],
    [1000n, [1n, 0n, 0n], [1000n, 0n, 0n]],
  ];

  it('splits exactly like contracts/money does', () => {
    for (const [total, weights, expected] of splits) {
      const parts = splitProRata(total, weights);
      expect(parts).toEqual(expected);
      expect(parts.reduce((sum, part) => sum + part, 0n)).toBe(total);
    }
  });

  it('rejects the same illegal splits as contracts/money does', () => {
    expect(() => splitProRata(100n, [0n, 0n, 0n])).toThrow(MoneyError);
    expect(() => splitProRata(1n, [0n, 0n])).toThrow(MoneyError);
    expect(() => splitProRata(100n, [1n, -1n])).toThrow(MoneyError);
  });

  it('ships the policy constants money-policy.json declares', () => {
    // money-policy.json: scale 7, mode half_even, display_dp 2.
    expect(STROOP_DECIMALS).toBe(7);
    expect(STROOP_SCALE).toBe(10_000_000n);
    expect(DEFAULT_MODE).toBe(RoundingMode.HalfEven);
    expect(DISPLAY_DECIMAL_PLACES).toBe(2);
  });
});

// ── Independent property checks ─────────────────────────────────────────────

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/**
 * Assert `got` is the unique legal rounding of `num / den` under `mode`, derived
 * from each mode's definition (bounds plus tie rule) instead of from a second
 * implementation of the same algorithm.
 */
function assertIsLegalRounding(num: bigint, den: bigint, mode: RoundingMode, got: bigint): void {
  expect(den).not.toBe(0n);
  const n = den < 0n ? -num : num;
  const d = den < 0n ? -den : den;

  const scaled = got * d;
  const distance = abs(scaled - n);

  switch (mode) {
    case RoundingMode.Floor: {
      expect(scaled).toBeLessThanOrEqual(n);
      expect(scaled + d).toBeGreaterThan(n);
      break;
    }
    case RoundingMode.Ceil: {
      expect(scaled).toBeGreaterThanOrEqual(n);
      expect(scaled - d).toBeLessThan(n);
      break;
    }
    case RoundingMode.HalfUp: {
      expect(2n * distance).toBeLessThanOrEqual(d);
      if (2n * distance === d) {
        // An exact tie rounds away from zero: up for a positive quotient, down
        // for a negative one.
        const tieExpected = n > 0n ? n / d + 1n : n / d - 1n;
        expect(got).toBe(tieExpected);
      }
      break;
    }
    case RoundingMode.HalfEven: {
      expect(2n * distance).toBeLessThanOrEqual(d);
      if (2n * distance === d) {
        expect(got % 2n).toBe(0n);
      }
      break;
    }
    default: {
      throw new Error(`unhandled rounding mode: ${String(mode)}`);
    }
  }
}

describe('roundDiv properties', () => {
  it('matches its definition on a small exhaustive domain', () => {
    for (let num = -60n; num <= 60n; num += 1n) {
      for (let den = -20n; den <= 20n; den += 1n) {
        if (den === 0n) {
          expect(() => roundDiv(num, den, RoundingMode.Floor)).toThrow(MoneyError);
          continue;
        }
        for (const mode of MODES) {
          assertIsLegalRounding(num, den, mode, roundDiv(num, den, mode));
        }
      }
    }
  });

  it('lands half-even ties on the even quotient and agrees with half-up elsewhere', () => {
    for (let den = 2n; den <= 41n; den += 1n) {
      for (let quotient = 0n; quotient <= 20n; quotient += 1n) {
        for (let offset = 0n; offset < den; offset += 1n) {
          const num = quotient * den + offset;
          const halfEven = roundDiv(num, den, RoundingMode.HalfEven);
          const halfUp = roundDiv(num, den, RoundingMode.HalfUp);
          assertIsLegalRounding(num, den, RoundingMode.HalfEven, halfEven);
          assertIsLegalRounding(num, den, RoundingMode.HalfUp, halfUp);

          if (offset * 2n === den) {
            expect(halfEven % 2n).toBe(0n);
          } else {
            expect(halfEven).toBe(halfUp);
          }
        }
      }
    }
  });

  it('matches its definition on randomized operands', () => {
    fc.assert(
      fc.property(
        fc.bigInt({
          min: -1_000_000_000_000_000_000_000_000n,
          max: 1_000_000_000_000_000_000_000_000n,
        }),
        fc
          .bigInt({ min: -1_000_000_000_000n, max: 1_000_000_000_000n })
          .filter((den) => den !== 0n),
        fc.constantFrom(...MODES),
        (num, den, mode) => {
          assertIsLegalRounding(num, den, mode, roundDiv(num, den, mode));
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('never returns a half-mode result further than half a unit from the exact quotient', () => {
    // Floor/Ceil deliberately sit up to (but not including) a whole unit away,
    // so the half-unit bound is a property of the rounding-to-nearest modes.
    fc.assert(
      fc.property(
        fc.bigInt({ min: -1_000_000_000_000_000_000n, max: 1_000_000_000_000_000_000n }),
        fc.bigInt({ min: 1n, max: 1_000_000_000_000n }),
        fc.constantFrom(RoundingMode.HalfEven, RoundingMode.HalfUp),
        (num, den, mode) => {
          const quotient = roundDiv(num, den, mode);
          const twiceDistance = abs(2n * (quotient * den - num));
          expect(twiceDistance).toBeLessThanOrEqual(den);
        },
      ),
      { numRuns: 2000 },
    );
  });
});

describe('splitProRata properties', () => {
  it('always allocates the total exactly, with no part more than one unit above its floor share', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000_000_000_000n }),
        fc.array(fc.bigInt({ min: 0n, max: 1_000_000_000n }), { minLength: 1, maxLength: 10 }),
        (total, weights) => {
          const weightSum = weights.reduce((sum, weight) => sum + weight, 0n);
          fc.pre(weightSum > 0n);

          const parts = splitProRata(total, weights);
          expect(parts).toHaveLength(weights.length);
          expect(parts.reduce((sum, part) => sum + part, 0n)).toBe(total);

          parts.forEach((part, index) => {
            const floor = (total * weights[index]!) / weightSum;
            expect(part).toBeGreaterThanOrEqual(floor);
            expect(part).toBeLessThanOrEqual(floor + 1n);
          });
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('is deterministic and rejects an impossible split', () => {
    expect(splitProRata(1_000_000_007n, [3n, 5n, 7n, 11n])).toEqual(
      splitProRata(1_000_000_007n, [3n, 5n, 7n, 11n]),
    );
    expect(() => splitProRata(42n, [])).toThrow(MoneyError);
    expect(() => splitProRata(100n, [0n, 0n, 0n])).toThrow(MoneyError);
  });
});
