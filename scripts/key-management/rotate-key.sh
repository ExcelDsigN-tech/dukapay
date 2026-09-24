#!/usr/bin/env bash
#
# rotate-key.sh — provision a new key version for a DukaPay signing key.
#
# This is a provider-agnostic scaffold. It shells out to the provider adapter
# (AWS CloudHSM or Fireblocks) via `scripts/key-management/provider.sh`. No key
# material is ever printed or written to disk in plaintext.
#
# Usage:
#   ./rotate-key.sh <deployer|admin|oracle|operator|jwt>
#
# Environment (references only — never secrets):
#   DUKAPAY_DEPLOYER_KEYREF   opaque HSM/MPC reference for the deployer key
#   DUKAPAY_ADMIN_KEYREF      opaque reference for the governance admin key
#   DUKAPAY_ORACLE_KEYREF     opaque reference for the oracle signer key
#   DUKAPAY_OPERATOR_KEYREF   opaque reference for the agent operator key
#   DUKAPAY_PROVIDER          cloudhsm | fireblocks
set -euo pipefail

KEY_TYPE="${1:-}"
case "$KEY_TYPE" in
  deployer|admin|oracle|operator|jwt) ;;
  *) echo "usage: $0 <deployer|admin|oracle|operator|jwt>" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "==> Rotating '$KEY_TYPE' key via provider '${DUKAPAY_PROVIDER:-unset}'"

# 1. Provision a new key version inside the HSM/MPC (key never leaves the device).
NEW_REF="$("$SCRIPT_DIR/provider.sh" rotate "$KEY_TYPE")"

# 2. Register the new public key with the relevant on-chain / off-chain consumer.
"$SCRIPT_DIR/provider.sh" register "$KEY_TYPE" "$NEW_REF"

# 3. Overlap grace period is handled by the consumer (both versions accepted).
echo "==> New key reference: $NEW_REF"
echo "==> Update DUKAPAY_${KEY_TYPE^^}_KEYREF and re-deploy config."
echo "==> Old version will be disabled after the grace period by 'disable-old'."

# 4. Record the rotation in the ops ledger (auditable).
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) rotate $KEY_TYPE -> $NEW_REF" \
  >> "$REPO_ROOT/ops/key-rotations.log"

echo "==> Done. Verify with: ./scan-secrets.sh"
