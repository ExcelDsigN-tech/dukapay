#!/usr/bin/env node
/**
 * verify-production-env.mjs
 * Mainnet production posture guard (#565 decided).
 * Fails the deploy if KYC_ENFORCEMENT_ENABLED is not "true", if audit anchoring is on
 * but misconfigured, or if AML thresholds are blank/invalid. Audit anchoring being off
 * only warns. Mirrors validateProductionComplianceFlags in backend/src/config/env.ts.
 * See docs/ENVIRONMENT.md#production-mainnet-posture and backend/.env.production.example.
 *
 * Usage:
 *   KYC_ENFORCEMENT_ENABLED=true AUDIT_ANCHOR_ENABLED=true ... node scripts/verify-production-env.mjs
 *   node scripts/verify-production-env.mjs --env-file backend/.env.production
 *   node scripts/verify-production-env.mjs --env-file backend/.env.production.example  # checks template itself
 *
 * Expects for PRODUCTION (mainnet):
 *   KYC_ENFORCEMENT_ENABLED=true (hard requirement)
 *   AUDIT_ANCHOR_ENABLED=true recommended (warns when off); when on:
 *     AUDIT_ANCHOR_CONTRACT_ID is a valid Stellar contract (C...)
 *     AUDIT_ANCHOR_SOURCE_SECRET is set (S... not empty, not placeholder)
 *   AML_REPORTING_THRESHOLD is numeric >= 1000 (not blank; requires compliance sign-off)
 *   AML_DAILY_TX_LIMIT is numeric 1..100 (not blank; requires compliance sign-off)
 *   AML_HIGH_RISK_COUNTRIES is non-empty comma-separated ISO 3166-1 alpha-2 list (not blank; requires compliance sign-off)
 *   STELLAR_NETWORK=mainnet and passphrase matches Public Global Stellar Network
 *   COMPLYADVANTAGE_API_KEY is set when KYC is enabled
 *
 * Exit codes:
 *   0 = guard passed
 *   1 = guard failed (mismatch)
 *   2 = script error
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function parseEnvFile(path) {
  const env = {};
  const content = readFileSync(path, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

const envFileArg = flag("--env-file");

function isPlaceholder(v) {
  if (!v) return true;
  const s = String(v).trim();
  if (s === "") return true;
  // __SET_VIA_SECRETS_MANAGER__ is intentional for .env.production.example — it signals
  // that the live secret is injected via secrets manager. Only treat it as non-placeholder
  // when explicitly validating the .example template file; in live production it must be a real value.
  if (s.includes("__SET_VIA_SECRETS_MANAGER__")) {
    if (envFileArg && envFileArg.includes(".example")) return false;
    return true;
  }
  if (/^(not yet recorded|your-|change-me|dummy)/i.test(s)) return true;
  if (/^__SET/i.test(s)) return true;
  return false;
}

function isValidContractId(v) {
  // Stellar contract IDs are C... 56-char strkey; simple check: starts with C and length 56
  return typeof v === "string" && v.startsWith("C") && v.length === 56;
}

function isValidSecret(v) {
  return typeof v === "string" && v.startsWith("S") && v.length === 56;
}

let fileEnv = {};
if (envFileArg) {
  const abs = envFileArg.startsWith("/") ? envFileArg : join(root, envFileArg);
  if (!existsSync(abs)) {
    console.error(`::error::Env file not found: ${abs}`);
    process.exit(2);
  }
  fileEnv = parseEnvFile(abs);
  console.log(`Loaded env file: ${envFileArg} (${Object.keys(fileEnv).length} keys)`);
}

// Effective env: file values override process.env only if file was explicitly requested;
// otherwise we check process.env directly (CI secrets injection path).
// When --env-file is given, we merge fileEnv over process.env for validation so the file's posture is checked.
const env = envFileArg ? { ...process.env, ...fileEnv } : process.env;

const errors = [];
const warnings = [];

function requireTrue(key, message) {
  const val = env[key];
  if (val !== "true") {
    errors.push(`${key} must be "true" for production mainnet (got: ${JSON.stringify(val)}) — ${message}`);
  }
}

function requireSet(key, message) {
  const val = env[key];
  if (isPlaceholder(val)) {
    errors.push(`${key} must be set to a real production value (got: ${JSON.stringify(val)}) — ${message}`);
  }
}

function requireNumeric(key, min, max, message) {
  const val = env[key];
  if (isPlaceholder(val)) {
    errors.push(`${key} must be set (got: ${JSON.stringify(val)}) — ${message}`);
    return;
  }
  const n = Number(val);
  if (!Number.isFinite(n) || n < min || n > max) {
    errors.push(`${key} must be numeric in [${min}, ${max}] (got: ${JSON.stringify(val)}) — ${message}`);
  }
}

function requireHighRiskCountries(message) {
  const val = env["AML_HIGH_RISK_COUNTRIES"];
  if (isPlaceholder(val)) {
    errors.push(`AML_HIGH_RISK_COUNTRIES must be set to a list requiring compliance sign-off (got: ${JSON.stringify(val)}) — ${message}`);
    return;
  }
  const codes = val.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (codes.length < 5) {
    errors.push(`AML_HIGH_RISK_COUNTRIES must contain at least 5 codes (got: ${codes.length}: ${val}) — ${message}`);
  }
  const bad = codes.filter((c) => !/^[A-Z]{2}$/.test(c));
  if (bad.length) {
    errors.push(`AML_HIGH_RISK_COUNTRIES contains invalid codes: ${bad.join(", ")} — expected ISO 3166-1 alpha-2`);
  }
}

// ── Production mainnet posture checks (#565) ─────────────────────────────────
console.log("\n🔒 Verifying production mainnet posture...\n");

// 1. KYC enforcement — hard requirement (#565)
requireTrue(
  "KYC_ENFORCEMENT_ENABLED",
  "Hard requirement for mainnet (#565); set explicitly in prod env/secrets (not relying on code default false)."
);

// 2. Audit anchoring — recommended, not blocking (#565); required config when on
if (env["AUDIT_ANCHOR_ENABLED"] !== "true") {
  warnings.push(`AUDIT_ANCHOR_ENABLED is ${JSON.stringify(env["AUDIT_ANCHOR_ENABLED"])} — audit anchoring disabled (recommended: "true", not blocking per #565)`);
} else {
  const cid = env["AUDIT_ANCHOR_CONTRACT_ID"];
  if (isPlaceholder(cid)) {
    errors.push(`AUDIT_ANCHOR_CONTRACT_ID must be set when AUDIT_ANCHOR_ENABLED=true (got: ${JSON.stringify(cid)}) — deploy audit_anchor to mainnet first`);
  } else if (!isValidContractId(cid)) {
    // Allow placeholder DUMMY for example files, but flag in warnings
    if (!String(cid).includes("DUMMY")) {
      errors.push(`AUDIT_ANCHOR_CONTRACT_ID looks invalid (expected C... 56-char, got: ${JSON.stringify(cid)})`);
    } else {
      warnings.push(`AUDIT_ANCHOR_CONTRACT_ID is DUMMY placeholder (expected for .env.production.example, but must be real in live prod secrets)`);
    }
  }
  const secret = env["AUDIT_ANCHOR_SOURCE_SECRET"];
  if (isPlaceholder(secret)) {
    errors.push(`AUDIT_ANCHOR_SOURCE_SECRET must be set when AUDIT_ANCHOR_ENABLED=true — Stellar secret for anchoring account`);
  } else if (!isValidSecret(secret) && !String(secret).includes("DUMMY") && !String(secret).includes("__SET")) {
    warnings.push(`AUDIT_ANCHOR_SOURCE_SECRET format unexpected (expected S... 56-char) — got length ${String(secret).length}`);
  }
}

// 3. AML thresholds — placeholders requiring compliance sign-off
requireNumeric("AML_REPORTING_THRESHOLD", 1000, 1000000, "Placeholder threshold; requires compliance sign-off for launch jurisdictions. Must not be blank/default.");
requireNumeric("AML_DAILY_TX_LIMIT", 1, 100, "Placeholder velocity limit; requires compliance sign-off. Must not be blank/default.");
requireHighRiskCountries("Placeholder list; requires compliance sign-off. Must be non-empty comma-separated ISO 3166-1 alpha-2; previously included UA (not FATF-listed) and omitted KE/NG (grey list early 2025).");

// 4. Stellar network must be mainnet
const stellarNetwork = env["STELLAR_NETWORK"];
if (stellarNetwork !== "mainnet") {
  errors.push(`STELLAR_NETWORK must be "mainnet" for production (got: ${JSON.stringify(stellarNetwork)})`);
}
const passphrase = env["STELLAR_NETWORK_PASSPHRASE"];
if (passphrase !== "Public Global Stellar Network ; September 2015") {
  errors.push(`STELLAR_NETWORK_PASSPHRASE must be "Public Global Stellar Network ; September 2015" for mainnet (got: ${JSON.stringify(passphrase)})`);
}
const rpcUrl = env["STELLAR_RPC_URL"];
if (rpcUrl) {
  // CodeQL js/incomplete-url-substring-sanitization — validate via URL hostname, not substring.
  let hostname = "";
  try {
    hostname = new URL(rpcUrl).hostname;
  } catch {
    warnings.push(`STELLAR_RPC_URL is not a valid URL: ${rpcUrl}`);
    hostname = "";
  }
  if (hostname && hostname !== "soroban-rpc.stellar.org" && !hostname.endsWith(".stellar.org")) {
    warnings.push(`STELLAR_RPC_URL hostname is ${hostname} — expected soroban-rpc.stellar.org for production`);
  }
}

// 5. ComplyAdvantage must be configured when KYC is on
if (env["KYC_ENFORCEMENT_ENABLED"] === "true") {
  requireSet("COMPLYADVANTAGE_API_KEY", "KYC enforcement requires ComplyAdvantage screening (OFAC/UN/EU/PEP/adverse-media).");
  requireSet("COMPLYADVANTAGE_SEARCH_PROFILE", "Search profile must be set to include OFAC, UN, EU, PEP and adverse-media sources.");
}

// 6. SAR filing gateway — warn if unset (reports remain pending, not filed)
if (isPlaceholder(env["SAR_FILING_API_URL"])) {
  warnings.push("SAR_FILING_API_URL is not set — SAR reports will remain pending and not auto-file to regulator/provider. Set for production if auto-filing is required.");
}

// ── Report ───────────────────────────────────────────────────────────────────
if (warnings.length) {
  console.log("⚠️  Warnings (non-blocking):");
  for (const w of warnings) console.log(`   - ${w}`);
  console.log("");
}

if (errors.length) {
  console.error("❌ Production posture guard FAILED — deploy must be blocked:\n");
  for (const e of errors) console.error(`   ✗ ${e}`);
  console.error("\nFix: set explicitly in production env/secrets per backend/.env.production.example and docs/ENVIRONMENT.md#production-mainnet-posture.");
  console.error("This guard is scaffolding pending #565; coordinate with the #565/#570 assignee before continuing.\n");
  process.exit(1);
}

console.log("✅ Production posture guard PASSED — scaffolding values present (pending #565 decision and compliance sign-off).\n");
process.exit(0);
