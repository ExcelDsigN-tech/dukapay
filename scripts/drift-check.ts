/**
 * scripts/drift-check.ts
 *
 * Environment drift sweep: verifies config parity between staging and production.
 *
 * Checks
 *   1. Env-var keys      — presence parity of every key in backend/.env.example
 *                          across each environment's dotenv file (values never printed).
 *   2. Feature flags      — value parity for the flags listed in the config.
 *   3. Service versions   — GET /version on each environment: nodeVersion, gitSha,
 *                          contract IDs.
 *   4. Database schema    — information_schema.columns + applied migrations,
 *                          compared row-for-row between the two databases.
 *
 * Differences declared in `expectedDifferences` (network-specific config) are
 * downgraded to INFO; anything else is DRIFT and exits non-zero.
 *
 * Usage
 *   tsx scripts/drift-check.ts [--format text|json|markdown] [--output FILE] [--remediate]
 *
 * Env
 *   STAGING_BASE_URL, PRODUCTION_BASE_URL          (for the /version check)
 *   STAGING_DATABASE_URL, PRODUCTION_DATABASE_URL  (for the schema check)
 *   Any check whose inputs are missing is reported as SKIPPED, not failed.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');

// ─── Types ────────────────────────────────────────────────────────────────────

type Severity = 'DRIFT' | 'INFO' | 'OK' | 'SKIPPED';

interface Finding {
  check: string;
  severity: Severity;
  detail: string;
  key?: string;
  staging?: string;
  production?: string;
}

interface Config {
  environments: Record<string, { baseUrlEnv: string; databaseUrlEnv: string; dotenvFile: string }>;
  canonicalEnvExample: string;
  featureFlags: string[];
  expectedDifferences: {
    envKeys: string[];
    versionFields: string[];
    contractIds: boolean;
  };
  secretEnvKeyPatterns: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadConfig(): Config {
  return require(path.join(REPO_ROOT, 'scripts/drift-check.config.json'));
}

function parseDotenvKeys(file: string): Map<string, string> | null {
  const abs = path.join(REPO_ROOT, file);
  if (!fs.existsSync(abs)) return null;
  const map = new Map<string, string>();
  for (const line of fs.readFileSync(abs, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return map;
}

function isSecret(key: string, patterns: string[]): boolean {
  return patterns.some((p) => key.toUpperCase().includes(p));
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// ─── Check 1 + 2: env vars & feature flags ────────────────────────────────────

function checkEnvVars(cfg: Config, findings: Finding[]): void {
  const canonical = parseDotenvKeys(cfg.canonicalEnvExample);
  const staging = parseDotenvKeys(cfg.environments.staging.dotenvFile);
  const production = parseDotenvKeys(cfg.environments.production.dotenvFile);

  if (!canonical) {
    findings.push({ check: 'env-keys', severity: 'SKIPPED', detail: `missing ${cfg.canonicalEnvExample}` });
    return;
  }
  if (!staging || !production) {
    findings.push({
      check: 'env-keys',
      severity: 'SKIPPED',
      detail: 'staging and/or production dotenv file not present in the checkout',
    });
    return;
  }

  const expected = new Set(cfg.expectedDifferences.envKeys);
  for (const key of canonical.keys()) {
    const inS = staging.has(key);
    const inP = production.has(key);
    if (inS === inP) continue;
    findings.push({
      check: 'env-keys',
      severity: expected.has(key) ? 'INFO' : 'DRIFT',
      key,
      detail: `key present in ${inS ? 'staging' : 'production'} only`,
      staging: inS ? 'set' : 'MISSING',
      production: inP ? 'set' : 'MISSING',
    });
  }

  // Keys present in an environment but absent from the canonical example.
  for (const [envName, map] of [
    ['staging', staging],
    ['production', production],
  ] as const) {
    for (const key of map.keys()) {
      if (!canonical.has(key) && !expected.has(key)) {
        findings.push({
          check: 'env-keys',
          severity: 'DRIFT',
          key,
          detail: `undocumented key in ${envName} (not in ${cfg.canonicalEnvExample})`,
        });
      }
    }
  }

  // Feature-flag value parity.
  for (const flag of cfg.featureFlags) {
    const s = staging.get(flag);
    const p = production.get(flag);
    if (s === undefined && p === undefined) continue;
    if (s === p) {
      findings.push({ check: 'feature-flags', severity: 'OK', key: flag, detail: 'match' });
      continue;
    }
    const redact = isSecret(flag, cfg.secretEnvKeyPatterns);
    findings.push({
      check: 'feature-flags',
      severity: 'DRIFT',
      key: flag,
      detail: 'feature flag value differs',
      staging: redact ? '<redacted>' : (s ?? 'MISSING'),
      production: redact ? '<redacted>' : (p ?? 'MISSING'),
    });
  }
}

// ─── Check 3: service versions ────────────────────────────────────────────────

async function checkVersions(cfg: Config, findings: Finding[]): Promise<void> {
  const sUrl = process.env[cfg.environments.staging.baseUrlEnv];
  const pUrl = process.env[cfg.environments.production.baseUrlEnv];
  if (!sUrl || !pUrl) {
    findings.push({ check: 'service-version', severity: 'SKIPPED', detail: 'STAGING_BASE_URL / PRODUCTION_BASE_URL not set' });
    return;
  }

  let s: any;
  let p: any;
  try {
    [s, p] = await Promise.all([
      fetchJson(`${sUrl.replace(/\/$/, '')}/version`),
      fetchJson(`${pUrl.replace(/\/$/, '')}/version`),
    ]);
  } catch (err) {
    findings.push({ check: 'service-version', severity: 'DRIFT', detail: `could not read /version: ${(err as Error).message}` });
    return;
  }

  const expectedFields = new Set(cfg.expectedDifferences.versionFields);
  for (const field of ['nodeVersion', 'gitSha', 'builtAt'] as const) {
    if (s[field] === p[field]) continue;
    findings.push({
      check: 'service-version',
      severity: expectedFields.has(field) ? 'INFO' : 'DRIFT',
      key: field,
      detail: field === 'gitSha' ? 'deployed commit differs (expected while prod lags staging)' : `${field} differs`,
      staging: String(s[field]),
      production: String(p[field]),
    });
  }

  const sc = s.contracts ?? {};
  const pc = p.contracts ?? {};
  for (const name of new Set([...Object.keys(sc), ...Object.keys(pc)])) {
    if (sc[name] === pc[name]) continue;
    findings.push({
      check: 'contract-id',
      severity: cfg.expectedDifferences.contractIds ? 'INFO' : 'DRIFT',
      key: name,
      detail: 'contract ID differs (staging=testnet vs production=mainnet is expected)',
      staging: sc[name] ?? 'unknown',
      production: pc[name] ?? 'unknown',
    });
  }
}

// ─── Check 4: database schema ─────────────────────────────────────────────────

const SCHEMA_QUERY = `
  SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position
`;
const MIGRATIONS_QUERY = `SELECT name FROM pgmigrations ORDER BY run_on`;

async function dumpSchema(dsn: string): Promise<{ columns: string[]; migrations: string[] }> {
  const { Client } = require('pg');
  const client = new Client({ connectionString: dsn, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    const cols = await client.query(SCHEMA_QUERY);
    const columns = cols.rows.map(
      (r: any) =>
        `${r.table_name}.${r.column_name} :: ${r.data_type} ${r.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}` +
        (r.column_default ? ` DEFAULT ${r.column_default}` : ''),
    );
    let migrations: string[] = [];
    try {
      const m = await client.query(MIGRATIONS_QUERY);
      migrations = m.rows.map((r: any) => r.name);
    } catch {
      /* pgmigrations table absent — report columns only */
    }
    return { columns, migrations };
  } finally {
    await client.end();
  }
}

function diffLists(check: string, label: string, s: string[], p: string[], findings: Finding[]): void {
  const sSet = new Set(s);
  const pSet = new Set(p);
  for (const item of s) {
    if (!pSet.has(item)) findings.push({ check, severity: 'DRIFT', detail: `${label} in staging only`, key: item });
  }
  for (const item of p) {
    if (!sSet.has(item)) findings.push({ check, severity: 'DRIFT', detail: `${label} in production only`, key: item });
  }
}

async function checkSchema(cfg: Config, findings: Finding[]): Promise<void> {
  const sDsn = process.env[cfg.environments.staging.databaseUrlEnv];
  const pDsn = process.env[cfg.environments.production.databaseUrlEnv];
  if (!sDsn || !pDsn) {
    findings.push({ check: 'db-schema', severity: 'SKIPPED', detail: 'STAGING_DATABASE_URL / PRODUCTION_DATABASE_URL not set' });
    return;
  }
  let s: Awaited<ReturnType<typeof dumpSchema>>;
  let p: Awaited<ReturnType<typeof dumpSchema>>;
  try {
    [s, p] = await Promise.all([dumpSchema(sDsn), dumpSchema(pDsn)]);
  } catch (err) {
    findings.push({ check: 'db-schema', severity: 'DRIFT', detail: `schema comparison failed: ${(err as Error).message}` });
    return;
  }
  diffLists('db-schema', 'column', s.columns, p.columns, findings);
  diffLists('db-migrations', 'migration', s.migrations, p.migrations, findings);
  if (!findings.some((f) => f.check.startsWith('db-') && f.severity === 'DRIFT')) {
    findings.push({ check: 'db-schema', severity: 'OK', detail: `schemas match (${s.columns.length} columns, ${s.migrations.length} migrations)` });
  }
}

// ─── Reporting ────────────────────────────────────────────────────────────────

function render(findings: Finding[], format: string): string {
  const drift = findings.filter((f) => f.severity === 'DRIFT');
  if (format === 'json') {
    return JSON.stringify({ drift: drift.length, findings }, null, 2);
  }
  const lines: string[] = [];
  const md = format === 'markdown';
  lines.push(md ? '# Environment Drift Sweep' : 'ENVIRONMENT DRIFT SWEEP');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Result: ${drift.length === 0 ? '✅ no drift' : `❌ ${drift.length} drift finding(s)`}`);
  lines.push('');
  const order: Severity[] = ['DRIFT', 'INFO', 'SKIPPED', 'OK'];
  for (const sev of order) {
    const group = findings.filter((f) => f.severity === sev);
    if (!group.length) continue;
    lines.push(md ? `## ${sev} (${group.length})` : `${sev} (${group.length})`);
    for (const f of group) {
      const loc = f.key ? ` [${f.key}]` : '';
      const vals = f.staging !== undefined ? ` — staging=${f.staging} production=${f.production}` : '';
      lines.push(`${md ? '- ' : '  '}${f.check}${loc}: ${f.detail}${vals}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function writeRemediation(findings: Finding[]): void {
  const drift = findings.filter((f) => f.severity === 'DRIFT' && !isSecretFinding(f));
  const body = [
    '## Automated drift remediation',
    '',
    'The nightly drift sweep found the following **non-secret** discrepancies between staging and production:',
    '',
    ...drift.map((f) => `- \`${f.check}\`${f.key ? ` \`${f.key}\`` : ''}: ${f.detail}` +
      (f.staging !== undefined ? ` (staging: \`${f.staging}\`, production: \`${f.production}\`)` : '')),
    '',
    'Review each item and update the lagging environment. Secret-valued drift (if any) is intentionally omitted and must be reconciled manually.',
    '',
    '_Generated by `scripts/drift-check.ts --remediate`._',
  ].join('\n');
  fs.writeFileSync(path.join(REPO_ROOT, 'drift-remediation.md'), body);
  console.error('Wrote drift-remediation.md');
}

function isSecretFinding(f: Finding): boolean {
  return f.staging === '<redacted>' || f.production === '<redacted>';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const format = flag('--format') ?? 'text';
  const output = flag('--output');
  const remediate = args.includes('--remediate');

  const cfg = loadConfig();
  const findings: Finding[] = [];

  checkEnvVars(cfg, findings);
  await checkVersions(cfg, findings);
  await checkSchema(cfg, findings);

  const report = render(findings, format);
  if (output) {
    fs.writeFileSync(output, report);
    console.error(`Report written to ${output}`);
  } else {
    console.log(report);
  }

  const driftCount = findings.filter((f) => f.severity === 'DRIFT').length;
  if (remediate && driftCount > 0) writeRemediation(findings);

  if (driftCount > 0) {
    console.error(`\n::error::Environment drift detected (${driftCount} finding(s))`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
