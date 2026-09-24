#!/usr/bin/env bash
#
# fuzz_campaign.sh — run the DukaPay fuzzing campaign.
#
# Executes every fuzz target in contracts/fuzz for the duration set by
# FUZZ_TIME (seconds). Any crash is a reproducible counterexample that must
# block merge (see contracts/FORMAL_VERIFICATION.md).
#
# Requires: cargo +nightly fuzz (cargo-fuzz). Run from repo root or contracts/.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
export FUZZ_TIME="${FUZZ_TIME:-300}"

TARGETS=(
  fuzz_target_1
  lending_pool_fuzz
  loan_manager_fuzz
  remittance_nft_fuzz
  multisig_governance_fuzz
  invariants_fuzz
)

for t in "${TARGETS[@]}"; do
  echo "===== fuzzing $t for ${FUZZ_TIME}s ====="
  cargo +nightly fuzz run "$t" -- -max_total_time="$FUZZ_TIME" \
    || { echo "FUZZ CRASH in $t — blocking merge"; exit 1; }
done

echo "===== fuzz campaign clean ====="
