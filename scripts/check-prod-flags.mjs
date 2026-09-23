#!/usr/bin/env node

/**
 * check-prod-flags.mjs
 *
 * Deploy-time guard for the KYC / audit-anchor launch posture
 * (docs/ENVIRONMENT.md, issue #565).
 *
 * Fails when:
 *  - docs/ENVIRONMENT.md does not mark KYC_ENFORCEMENT_ENABLED and
 *    AUDIT_ANCHOR_ENABLED as required in staging/production, or
 *  - docker-compose.staging.yml does not explicitly set both to `true`
 *    (so staging can't silently inherit the `false` dev default).
 *
 * Usage:
 *   node scripts/check-prod-flags.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const FLAGS = ["KYC_ENFORCEMENT_ENABLED", "AUDIT_ANCHOR_ENABLED"];
let failed = false;

// 1. docs/ENVIRONMENT.md must mark both flags required in staging + prod.
const envDoc = readFileSync(join(root, "docs", "ENVIRONMENT.md"), "utf-8");
for (const flag of FLAGS) {
  const row = envDoc.split("\n").find((line) => line.includes(`\`${flag}\``));
  // Expected table shape: | `FLAG` | — | ✓ | ✓ | `false` | ... |
  const requiredInStagingProd =
    row !== undefined && /\| — \| ✓ \| ✓ \|/.test(row);
  if (!requiredInStagingProd) {
    console.error(
      `❌ docs/ENVIRONMENT.md must mark ${flag} as required (✓) in staging and production.`,
    );
    failed = true;
  }
}

// 2. docker-compose.staging.yml must explicitly enable both.
const stagingCompose = readFileSync(
  join(root, "docker-compose.staging.yml"),
  "utf-8",
);
for (const flag of FLAGS) {
  if (!stagingCompose.includes(`${flag}=true`)) {
    console.error(
      `❌ docker-compose.staging.yml must explicitly set ${flag}=true.`,
    );
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("✅ Prod-flag launch posture OK (KYC + audit-anchor).");
