#!/usr/bin/env node

/**
 * check-prod-flags.mjs
 *
 * Deploy-time guard for the KYC / audit-anchor launch posture
 * (docs/ENVIRONMENT.md, issue #565).
 *
 * Maintainer decision (#565):
 *  - KYC_ENFORCEMENT_ENABLED is a hard boot requirement in production.
 *    docs must mark it required in staging/prod and staging compose must
 *    set it to `true`.
 *  - AUDIT_ANCHOR_ENABLED is recommended, not blocking. When off in
 *    production we warn; when on, AUDIT_ANCHOR_CONTRACT_ID and
 *    AUDIT_ANCHOR_SOURCE_SECRET are required (otherwise anchoring would
 *    silently no-op).
 *
 * Fails when:
 *  - docs/ENVIRONMENT.md does not mark KYC_ENFORCEMENT_ENABLED as required
 *    in staging/production, or
 *  - docker-compose.staging.yml does not explicitly set KYC_ENFORCEMENT_ENABLED=true, or
 *  - docker-compose.staging.yml sets AUDIT_ANCHOR_ENABLED=true without also
 *    passing AUDIT_ANCHOR_CONTRACT_ID / AUDIT_ANCHOR_SOURCE_SECRET through.
 *
 * Usage:
 *   node scripts/check-prod-flags.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

let failed = false;

// 1. docs/ENVIRONMENT.md must mark KYC as required in staging + prod.
const envDoc = readFileSync(join(root, "docs", "ENVIRONMENT.md"), "utf-8");
const kycRow = envDoc.split("\n").find((line) => line.includes("`KYC_ENFORCEMENT_ENABLED`"));
// Expected table shape: | `FLAG` | — | ✓ | ✓ | `false` | ... |
const kycRequired = kycRow !== undefined && /\| — \| ✓ \| ✓ \|/.test(kycRow);
if (!kycRequired) {
  console.error(
    "❌ docs/ENVIRONMENT.md must mark KYC_ENFORCEMENT_ENABLED as required (✓) in staging and production.",
  );
  failed = true;
}

// 1b. docs must describe AUDIT_ANCHOR_ENABLED as recommended (not hard-required)
// and document that enabling it requires CONTRACT_ID + SOURCE_SECRET.
const auditRow = envDoc.split("\n").find((line) => line.includes("`AUDIT_ANCHOR_ENABLED`"));
if (auditRow === undefined || !/recommended/i.test(auditRow)) {
  console.error(
    "❌ docs/ENVIRONMENT.md must describe AUDIT_ANCHOR_ENABLED as recommended (warns when off, requires CONTRACT_ID + SOURCE_SECRET when on).",
  );
  failed = true;
}

// 2. docker-compose.staging.yml must explicitly enable KYC.
const stagingCompose = readFileSync(
  join(root, "docker-compose.staging.yml"),
  "utf-8",
);
if (!stagingCompose.includes("KYC_ENFORCEMENT_ENABLED=true")) {
  console.error(
    "❌ docker-compose.staging.yml must explicitly set KYC_ENFORCEMENT_ENABLED=true.",
  );
  failed = true;
}

// 2b. If staging enables audit anchoring, it must also pass the anchor config
// through — otherwise the cron job runs hourly and silently skips every epoch.
if (stagingCompose.includes("AUDIT_ANCHOR_ENABLED=true")) {
  for (const v of ["AUDIT_ANCHOR_CONTRACT_ID", "AUDIT_ANCHOR_SOURCE_SECRET"]) {
    if (!stagingCompose.includes(v)) {
      console.error(
        `❌ docker-compose.staging.yml sets AUDIT_ANCHOR_ENABLED=true but does not pass ${v} through — anchoring would silently no-op.`,
      );
      failed = true;
    }
  }
} else {
  console.log(
    "ℹ️  docker-compose.staging.yml leaves AUDIT_ANCHOR_ENABLED off/unset (recommended, not required).",
  );
}

if (failed) process.exit(1);
console.log("✅ Prod-flag launch posture OK (KYC required, audit-anchor recommended + guarded).");
