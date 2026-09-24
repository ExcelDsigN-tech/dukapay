#!/usr/bin/env bash
#
# emergency-revoke.sh — disable / zeroize a compromised DukaPay signing key.
#
# Run this IMMEDIATELY after tripping the CircuitBreaker (pause_all) when a key
# is suspected compromised. This disables the key in the HSM/MPC so it can no
# longer sign; it does NOT touch on-chain state (rotation + override resume
# that). See docs/security/key-management.md.
#
# Usage:
#   ./emergency-revoke.sh <deployer|admin|oracle|operator|jwt>
set -euo pipefail

KEY_TYPE="${1:-}"
case "$KEY_TYPE" in
  deployer|admin|oracle|operator|jwt) ;;
  *) echo "usage: $0 <deployer|admin|oracle|operator|jwt>" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "!!! EMERGENCY REVOCATION: '$KEY_TYPE'"
echo "!!! Step 0 (manual): trip CircuitBreaker.pause_all to halt value movement."
read -r -p "Confirm CircuitBreaker is paused (yes/no): " CONFIRM
if [ "${CONFIRM:-no}" != "yes" ]; then
  echo "Aborted. Pause the breaker first." >&2
  exit 1
fi

# 1. Disable / zeroize the key version in the HSM/MPC (provider adapter).
"$SCRIPT_DIR/provider.sh" revoke "$KEY_TYPE"

# 2. Audit log.
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) EMERGENCY-REVOKE $KEY_TYPE" \
  >> "$REPO_ROOT/ops/key-rotations.log"

echo "==> Key '$KEY_TYPE' disabled."
echo "==> Next: provision a replacement via './rotate-key.sh $KEY_TYPE',"
echo "==> register its public key, then resume via CircuitBreaker override."
