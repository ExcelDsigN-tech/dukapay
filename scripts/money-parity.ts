/**
 * Cross-language money-policy parity runner (issue #432).
 *
 * The stroop-integer money kernel exists twice on purpose — once in Rust
 * (`contracts/money/src/lib.rs`, the on-chain implementation) and once in
 * TypeScript (`backend/src/money/decimal.ts`, the off-chain settlement path) —
 * and `money-policy.json` is the single source of truth for the constants they
 * share. Nothing until now actually executed both implementations over the same
 * inputs: `cargo test -p money` and the backend jest suite each only pin their
 * own side, so a tie-break or normalization change could silently make the two
 * layers disagree about the same stroop amount.
 *
 * This runner closes that gap. It:
 *
 *   1. loads the shared vectors from `tests/money-parity/vectors.json`,
 *   2. asserts the shipped policy constants in `decimal.ts` still match
 *      `money-policy.json` (and that the vectors file mirrors it),
 *   3. replays every vector's case string through the Rust kernel (batched into
 *      a single `cargo run`, fed over stdin so a large randomized batch cannot
 *      exceed the OS argument-list limit) and through `decimal.ts`,
 *   4. optionally generates randomized cases across the same operations and
 *      diffs the two implementations on those as well,
 *   5. exits non-zero on the first divergence, printing both sides so the drift
 *      is actionable.
 *
 * Usage (from the repository root):
 *   npx tsx scripts/money-parity.ts
 *   npx tsx scripts/money-parity.ts --randomized 5000
 *   npx tsx scripts/money-parity.ts --randomized 5000 --seed 0x432432
 *
 * Caveats, stated rather than hidden:
 *   - `backend/src/money/calculations.ts` is float/`Math.round`-based and does
 *     not share the kernel, so it is deliberately not compared here; doing so
 *     would compare two different formulas, not two implementations of one.
 *   - `decimal.ts` uses unbounded `bigint` while the contract's intermediates are
 *     checked `i128`, and `split_pro_rata`'s contract entry point does not reject
 *     a negative total that `decimal.ts` does. Randomized `round_div`/`split_pro_rata`
 *     inputs therefore stay inside the domain both agree on (the domain the
 *     policy documents: non-negative totals and weights, products inside i128).
 *     The `compute_fee`/`calculate_interest`/`round_amount` reductions do emulate
 *     the contract's `checked_mul` bound so the overflow vectors are comparable.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  DEFAULT_MODE,
  DISPLAY_DECIMAL_PLACES,
  MoneyError,
  RoundingMode,
  roundDiv,
  splitProRata,
  STROOP_SCALE,
  STROOP_DECIMALS,
} from '../backend/src/money/decimal.js';

interface PolicyFile {
  scale: number;
  mode: string;
  display_dp: number;
  allocation: string;
}

interface VectorCase {
  id: string;
  operation: string;
  input: string;
  expected: string;
}

interface VectorFile {
  policy: PolicyFile;
  notes: string[];
  cases: VectorCase[];
}

const ROOT = path.resolve(__dirname, '..');

/** `i128::MAX` / `i128::MIN`, the bounds the contract's checked math enforces. */
const I128_MAX = (1n << 127n) - 1n;
const I128_MIN = -(1n << 127n);

/** Stroops per displayed cent (`10^(scale - display_dp)` == `10^5`). */
const STROOPS_PER_CENT = 100_000n;
/** Basis points in one whole unit (`100%` == `10_000` bps). */
const BPS_DENOMINATOR = 10_000n;
/** Days used to annualize a rate. */
const DAYS_PER_YEAR = 365n;

const MASK64 = (1n << 64n) - 1n;

const MONEY_ERROR_CODES: Record<string, string> = {
  // decimal.ts is stricter than the contract here: both map to the same
  // "the inputs are not a legal split" outcome the runner reports.
  'total must be non-negative': 'drift_detected',
  'cannot split a nonzero total across zero weights': 'drift_detected',
  'cannot split a nonzero total across zero total weight': 'drift_detected',
  'weights must be non-negative': 'drift_detected',
  'drift detected while splitting pro-rata amounts': 'drift_detected',
  'division by zero': 'div_by_zero',
};

function errorCode(err: unknown): string {
  if (err instanceof MoneyError) {
    const code = MONEY_ERROR_CODES[err.message];
    if (code !== undefined) {
      return code;
    }
    throw new Error(`money-parity: unmapped MoneyError from decimal.ts: ${err.message}`);
  }
  throw err;
}

function parseMode(raw: string | undefined): RoundingMode | null {
  switch (raw) {
    case 'half_even':
      return RoundingMode.HalfEven;
    case 'half_up':
      return RoundingMode.HalfUp;
    case 'floor':
      return RoundingMode.Floor;
    case 'ceil':
      return RoundingMode.Ceil;
    default:
      return null;
  }
}

/** Parse an i128-shaped integer, rejecting anything Rust's `parse::<i128>` would reject. */
function parseI128(raw: string | undefined): bigint | null {
  if (raw === undefined || !/^-?\d+$/.test(raw)) {
    return null;
  }
  const value = BigInt(raw);
  return value > I128_MAX || value < I128_MIN ? null : value;
}

/** Emulates the contract's `checked_mul`, which returns `None` on i128 overflow. */
function checkedMul(a: bigint, b: bigint): bigint | null {
  const product = a * b;
  return product > I128_MAX || product < I128_MIN ? null : product;
}

function renderDiv(num: bigint, den: bigint, mode: RoundingMode): string {
  try {
    return `ok ${roundDiv(num, den, mode)}`;
  } catch (err) {
    return `err ${errorCode(err)}`;
  }
}

function renderSplit(total: bigint, weights: readonly bigint[]): string {
  try {
    return `ok ${splitProRata(total, weights).join(',')}`;
  } catch (err) {
    return `err ${errorCode(err)}`;
  }
}

/** Mirrors `run_case` in `contracts/money/examples/parity_report.rs`. */
export function runCase(input: string): string {
  const parts = input.split(':');
  const kind = parts[0];

  if (kind === 'round_div' && parts.length === 4) {
    const num = parseI128(parts[1]);
    const den = parseI128(parts[2]);
    const mode = parseMode(parts[3]);
    if (num === null || den === null || mode === null) {
      return 'err bad_input';
    }
    return renderDiv(num, den, mode);
  }

  if (kind === 'split_pro_rata' && parts.length === 3) {
    const total = parseI128(parts[1]);
    if (total === null) {
      return 'err bad_input';
    }
    const weights: bigint[] = [];
    for (const raw of parts[2].split(',')) {
      const weight = parseI128(raw);
      if (weight === null) {
        return 'err bad_input';
      }
      weights.push(weight);
    }
    return renderSplit(total, weights);
  }

  if (kind === 'derived' && parts[1] === 'compute_fee' && parts.length === 4) {
    const principal = parseI128(parts[2]);
    const rateBps = parseI128(parts[3]);
    if (principal === null || rateBps === null) {
      return 'err bad_input';
    }
    const product = checkedMul(principal, rateBps);
    return product === null ? 'err overflow' : renderDiv(product, BPS_DENOMINATOR, RoundingMode.HalfEven);
  }

  if (kind === 'derived' && parts[1] === 'calculate_interest' && parts.length === 5) {
    const principal = parseI128(parts[2]);
    const rateBps = parseI128(parts[3]);
    const days = parseI128(parts[4]);
    if (principal === null || rateBps === null || days === null) {
      return 'err bad_input';
    }
    const scaled = checkedMul(principal, rateBps);
    const product = scaled === null ? null : checkedMul(scaled, days);
    const denominator = checkedMul(BPS_DENOMINATOR, DAYS_PER_YEAR);
    if (product === null || denominator === null) {
      return 'err overflow';
    }
    return renderDiv(product, denominator, RoundingMode.HalfEven);
  }

  if (kind === 'derived' && parts[1] === 'round_amount' && parts.length === 3) {
    const stroops = parseI128(parts[2]);
    if (stroops === null) {
      return 'err bad_input';
    }
    try {
      const cents = roundDiv(stroops, STROOPS_PER_CENT, RoundingMode.HalfEven);
      const quantized = checkedMul(cents, STROOPS_PER_CENT);
      return quantized === null ? 'err overflow' : `ok ${quantized}`;
    } catch (err) {
      return `err ${errorCode(err)}`;
    }
  }

  return 'err bad_input';
}

/** Deterministic xorshift64* so a reported seed reproduces the exact run. */
function makeRng(seed: bigint): () => bigint {
  let state = seed & MASK64;
  return () => {
    state = (state ^ (state << 13n)) & MASK64;
    state = state ^ (state >> 7n);
    state = (state ^ (state << 17n)) & MASK64;
    return (state * 0x2545f4914f6cdd1dn) & MASK64;
  };
}

function randRange(next: () => bigint, lo: bigint, hi: bigint): bigint {
  return lo + (next() % (hi - lo + 1n));
}

const MODE_NAMES = ['half_even', 'half_up', 'floor', 'ceil'];

function randomGrounding(next: () => bigint): string {
  // A quarter of the cases stay small so exact ties (where the modes differ)
  // and negative numerators/denominators are hit often, not just by luck.
  const small = next() % 4n === 0n;
  const num = small ? randRange(next, -50n, 50n) : randRange(next, -(10n ** 18n), 10n ** 18n);
  let den = small ? randRange(next, -20n, 20n) : randRange(next, -(10n ** 9n), 10n ** 9n);
  if (den === 0n) {
    den = 1n;
  }
  const mode = MODE_NAMES[Number(randRange(next, 0n, 3n))]!;
  return `round_div:${num}:${den}:${mode}`;
}

function randomSplit(next: () => bigint): string {
  let weights: bigint[] = [];
  for (;;) {
    const n = Number(randRange(next, 1n, 8n));
    weights = Array.from({ length: n }, () => randRange(next, 0n, 10_000_000n));
    if (weights.some((w) => w > 0n)) {
      break;
    }
  }
  // total * max(weight) stays inside i128, matching the domain both layers
  // handle: the contract rejects the checked-product overflow, decimal.ts has
  // no overflow to report.
  const total = randRange(next, 0n, 10n ** 15n);
  return `split_pro_rata:${total}:${weights.join(',')}`;
}

function randomDerived(next: () => bigint): string {
  switch (Number(randRange(next, 0n, 2n))) {
    case 0: {
      const principal = randRange(next, 0n, 10n ** 18n);
      const rateBps = randRange(next, 0n, 10_000n);
      return `derived:compute_fee:${principal}:${rateBps}`;
    }
    case 1: {
      const principal = randRange(next, 0n, 10n ** 18n);
      const rateBps = randRange(next, 0n, 10_000n);
      const days = randRange(next, 0n, 365n);
      return `derived:calculate_interest:${principal}:${rateBps}:${days}`;
    }
    default: {
      const stroops = randRange(next, I128_MIN, I128_MAX);
      return `derived:round_amount:${stroops}`;
    }
  }
}

function randomCases(count: number, seed: bigint): string[] {
  const next = makeRng(seed);
  const cases: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const bucket = Number(randRange(next, 0n, 2n));
    cases.push(bucket === 0 ? randomGrounding(next) : bucket === 1 ? randomSplit(next) : randomDerived(next));
  }
  return cases;
}

function runRust(cases: readonly string[]): string[] {
  const args = [
    'run',
    '--quiet',
    '--manifest-path',
    path.join(ROOT, 'contracts', 'Cargo.toml'),
    '-p',
    'money',
    '--example',
    'parity_report',
  ];
  // Cases go over stdin rather than argv: a large randomized batch would blow
  // past the OS argument-list limit (E2BIG) long before it exhausted memory.
  const stdout = execFileSync('cargo', args, {
    encoding: 'utf8',
    input: `${cases.join('\n')}\n`,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines = stdout.split('\n').filter((line) => line.length > 0);
  if (lines.length !== cases.length) {
    throw new Error(
      `money-parity: cargo printed ${lines.length} result lines for ${cases.length} cases — expected exactly one line per case:\n${stdout}`,
    );
  }
  return lines;
}

function loadVectors(): VectorFile {
  const raw = fs.readFileSync(path.join(ROOT, 'tests', 'money-parity', 'vectors.json'), 'utf8');
  return JSON.parse(raw) as VectorFile;
}

/**
 * `money-policy.json` is the single source of truth; the vectors file mirrors it
 * and `decimal.ts` must derive its constants from it.
 */
function checkPolicy(vectors: VectorFile): string[] {
  const problems: string[] = [];
  const policy = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'money-policy.json'), 'utf8'),
  ) as PolicyFile;

  const compare = (field: keyof PolicyFile): void => {
    if (vectors.policy[field] !== policy[field]) {
      problems.push(
        `tests/money-parity/vectors.json policy.${field}=${vectors.policy[field]} does not mirror money-policy.json ${field}=${policy[field]}`,
      );
    }
  };
  (Object.keys(policy) as Array<keyof PolicyFile>).forEach(compare);

  const expectedScale = 10n ** BigInt(policy.scale);
  if (STROOP_SCALE !== expectedScale) {
    problems.push(`decimal.ts STROOP_SCALE=${STROOP_SCALE} but money-policy.json scale=${policy.scale}`);
  }
  if (BigInt(STROOP_DECIMALS) !== BigInt(policy.scale)) {
    problems.push(`decimal.ts STROOP_DECIMALS=${STROOP_DECIMALS} but money-policy.json scale=${policy.scale}`);
  }
  if (DEFAULT_MODE !== policy.mode) {
    problems.push(`decimal.ts DEFAULT_MODE=${DEFAULT_MODE} but money-policy.json mode=${policy.mode}`);
  }
  if (BigInt(DISPLAY_DECIMAL_PLACES) !== BigInt(policy.display_dp)) {
    problems.push(
      `decimal.ts DISPLAY_DECIMAL_PLACES=${DISPLAY_DECIMAL_PLACES} but money-policy.json display_dp=${policy.display_dp}`,
    );
  }
  if (STROOP_SCALE / 10n ** BigInt(policy.display_dp) !== STROOPS_PER_CENT) {
    problems.push('money-parity: STROOPS_PER_CENT no longer matches the policy scale');
  }
  if (policy.allocation !== 'largest_remainder') {
    problems.push(`money-policy.json allocation=${policy.allocation} is not implemented by this runner`);
  }
  return problems;
}

function main(): void {
  const args = process.argv.slice(2);
  let randomized = 2000;
  let seed = 0x432_432_432_432n;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      console.log('usage: npx tsx scripts/money-parity.ts [--randomized N] [--seed 0xHEX|N]');
      return;
    }
    if (arg.startsWith('--randomized')) {
      const value = arg.includes('=') ? arg.split('=')[1] : args[i + 1];
      if (value === undefined) {
        throw new Error('money-parity: --randomized needs a count');
      }
      randomized = Number.parseInt(value, 10);
      if (!Number.isInteger(randomized) || randomized < 0) {
        throw new Error(`money-parity: invalid --randomized count: ${value}`);
      }
      if (!arg.includes('=')) {
        i += 1;
      }
      continue;
    }
    if (arg.startsWith('--seed')) {
      const value = arg.includes('=') ? arg.split('=')[1] : args[i + 1];
      if (value === undefined) {
        throw new Error('money-parity: --seed needs a value');
      }
      seed = BigInt(value.startsWith('0x') ? value : `0x${value}`);
      if (!arg.includes('=')) {
        i += 1;
      }
      continue;
    }
    throw new Error(`money-parity: unknown argument ${arg}`);
  }

  const vectors = loadVectors();
  const problems = checkPolicy(vectors);
  const inputs = vectors.cases.map((c) => c.input);
  const rustLines = runRust(inputs);

  vectors.cases.forEach((testCase, index) => {
    const rust = rustLines[index]!;
    const ts = runCase(testCase.input);
    if (rust !== testCase.expected) {
      problems.push(
        `[${testCase.id}] contracts/money says ${rust} but vectors/money say ${testCase.expected} (${testCase.input})`,
      );
    }
    if (ts !== testCase.expected) {
      problems.push(
        `[${testCase.id}] backend/src/money/decimal.ts says ${ts} but vectors/money say ${testCase.expected} (${testCase.input})`,
      );
    }
  });

  let crossChecked = 0;
  if (randomized > 0) {
    const generated = randomCases(randomized, seed);
    const rustRandom = runRust(generated);
    generated.forEach((input, index) => {
      const rust = rustRandom[index]!;
      const ts = runCase(input);
      if (rust !== ts) {
        problems.push(`[random] ${input}: contracts/money says ${rust}, decimal.ts says ${ts}`);
      }
      crossChecked += 1;
    });
  }

  if (problems.length > 0) {
    console.error(`money-parity: FAILED — ${problems.length} divergence(s)`);
    for (const problem of problems.slice(0, 25)) {
      console.error(`  ${problem}`);
    }
    if (problems.length > 25) {
      console.error(`  ...and ${problems.length - 25} more`);
    }
    process.exit(1);
  }

  console.log(
    `money-parity: OK — ${inputs.length} shared vectors agreed with contracts/money and decimal.ts, ` +
      `${crossChecked} randomized cases cross-checked (seed=0x${seed.toString(16)})`,
  );
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message.startsWith('money-parity:') ? message : `money-parity: ${message}`);
  process.exit(1);
}
