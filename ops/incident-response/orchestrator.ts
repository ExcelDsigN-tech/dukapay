import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

type Severity = "low" | "medium" | "high" | "critical";
interface Runbook { severity: Severity; containment: string[]; evidence: string[] }
interface Catalog { version: number; notifications: { severity: Record<Severity, string[]> }; runbooks: Record<string, Runbook> }

const execFileAsync = promisify(execFile);
const actions: Record<string, [string, string[]]> = {
  revoke_tokens: ["kubectl", ["-n", "dukapay", "create", "job", "--from=cronjob/token-revoker", "incident-token-revocation"]],
  quarantine_namespace: ["kubectl", ["-n", "dukapay", "apply", "-f", "infra/kubernetes/zero-trust/quarantine.yaml"]],
  disable_affected_credentials: ["kubectl", ["-n", "dukapay", "create", "job", "--from=cronjob/credential-disabler", "incident-credential-disable"]],
  pause_contracts: ["kubectl", ["-n", "dukapay", "create", "job", "--from=cronjob/contract-pauser", "incident-contract-pause"]],
  pause_payments: ["kubectl", ["-n", "dukapay", "create", "job", "--from=cronjob/payment-pauser", "incident-payment-pause"]],
  enable_rate_limits: ["kubectl", ["-n", "istio-system", "apply", "-f", "infra/kubernetes/zero-trust/incident-rate-limit.yaml"]],
  enable_circuit_breakers: ["kubectl", ["-n", "dukapay", "apply", "-f", "infra/kubernetes/zero-trust/incident-circuit-breaker.yaml"]],
  disable_deployments: ["kubectl", ["-n", "dukapay", "scale", "deployment", "--all", "--replicas=0"]],
  // Referenced by the data-breach / insider-threat runbooks: verify the
  // database access policy still exists (read-only verification, not a
  // mutation). Real access changes follow docs/runbooks/ manual steps,
  // never this orchestrator. Policy lives in
  // infra/kubernetes/zero-trust/policies.yaml as `allow-db-access`.
  verify_database_access_policy: ["kubectl", ["-n", "dukapay", "get", "networkpolicy", "allow-db-access", "-o", "yaml"]],
};

async function main(): Promise<void> {
  const [, , scenario, ...flags] = process.argv;
  const dryRun = flags.includes("--dry-run");
  if (!scenario) throw new Error("Usage: tsx ops/incident-response/orchestrator.ts <scenario> [--dry-run]");

  const here = dirname(fileURLToPath(import.meta.url));
  const catalog = JSON.parse(await readFile(join(here, "runbooks.json"), "utf8")) as Catalog;
  const runbook = catalog.runbooks[scenario];
  if (!runbook) throw new Error(`Unknown incident scenario: ${scenario}`);

  process.stdout.write(`Scenario: ${scenario} (severity: ${runbook.severity})\n`);
  const notifyGroups = catalog.notifications?.severity?.[runbook.severity] ?? [];
  if (notifyGroups.length > 0) process.stdout.write(`Notify: ${notifyGroups.join(", ")}\n`);

  for (const action of runbook.containment) {
    const command = actions[action];
    if (!command) throw new Error(`Action is not allowlisted: ${action}`);
    process.stdout.write(`${dryRun ? "DRY RUN " : ""}${command[0]} ${command[1].join(" ")}\n`);
    if (!dryRun) await execFileAsync(command[0], command[1]);
  }

  for (const item of runbook.evidence) {
    process.stdout.write(`Evidence: ${item} (collect per docs/runbooks/ before closing)\n`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
