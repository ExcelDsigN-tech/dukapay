#!/usr/bin/env bash
#
# scan-secrets.sh — "no hardcoded secrets" guard for DukaPay.
#
# Fails (exit 1) if it finds likely secret material in source. Intended to run
# in pre-commit and CI. Only key *references* (ARNs, vault IDs) are allowed;
# never key *bytes*.
#
# Allow-list exceptions (intentional test fixtures, schema field names) live in
# .secrets.allow (regex per line).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

ALLOW_FILE="${SECRETS_ALLOW:-.secrets.allow}"

# Patterns that indicate a leaked secret (case-insensitive).
PATTERNS=(
  "S[0-9a-zA-Z]{55}"                                   # Stellar secret seed
  "(private_?key|mnemonic|passphrase|password|secret)[\"'=: ]*[\"'][A-Za-z0-9/+]{16,}"  # quoted literal assignment
  "-----BEGIN (EC |RSA |OPENSSH |PGP )?PRIVATE KEY-----"
  "AKIA[0-9A-Z]{16}[^0-9A-Z]"                          # AWS access key id literal
  "ghp_[0-9A-Za-z]{36}"                                # GitHub PAT literal
  "sk_live_[0-9a-zA-Z]{24,}"                           # Stripe-style secret literal
)

MATCHES=0
while IFS= read -r -d '' file; do
  for pat in "${PATTERNS[@]}"; do
    if grep -IniE "$pat" "$file" 2>/dev/null | grep -qvEf <(cat "$ALLOW_FILE" 2>/dev/null); then
      echo "POSSIBLE SECRET in $file:"
      grep -IniE "$pat" "$file" | grep -vEf <(cat "$ALLOW_FILE" 2>/dev/null) | sed 's/^/  /'
      MATCHES=$((MATCHES+1))
    fi
  done
done < <(grep -rIl . --include='*.ts' --include='*.rs' --include='*.js' \
            --include='*.py' --include='*.sh' --include='*.json' \
            --exclude-dir=node_modules --exclude-dir=target --exclude-dir=dist \
            --exclude-dir=.git --exclude-dir=build --exclude-dir=coverage .)

if [ "$MATCHES" -gt 0 ]; then
  echo "SECRET SCAN FAILED: $MATCHES file(s) matched." >&2
  exit 1
fi

echo "SECRET SCAN OK: no hardcoded secrets found."
