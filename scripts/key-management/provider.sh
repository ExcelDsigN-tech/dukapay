#!/usr/bin/env bash
#
# provider.sh — thin wrapper around the provider adapter (provider.ts).
# Dispatches key lifecycle commands to AWS CloudHSM or Fireblocks based on
# DUKAPAY_PROVIDER. No key material is printed.
#
# Commands:
#   provider.sh rotate <key-type>     -> prints new opaque key reference
#   provider.sh register <key-type> <ref>   -> registers the new public key
#   provider.sh revoke <key-type>     -> disables/zeroizes the key in the HSM/MPC
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION="${1:-}"
KEY_TYPE="${2:-}"
REF="${3:-}"

if [ -z "${DUKAPAY_PROVIDER:-}" ]; then
  echo "DUKAPAY_PROVIDER is not set (cloudhsm|fireblocks)" >&2
  exit 1
fi

if [ ! -x "$(command -v node)" ]; then
  echo "node is required to run the provider adapter" >&2
  exit 1
fi

exec npx tsx "$SCRIPT_DIR/provider.ts" "$ACTION" "$KEY_TYPE" "$REF"
