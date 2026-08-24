import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

type Severity = "low" | "medium" | "high" | "critical";
interface Runbook { severity: Severity; containment: string[]; evidence: string[] }
interface Catalog { version: number; runbooks: Record<string, Runbook> }

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
};

const [, , scenario, ...flags] = process.argv;
const dryRun = flags.includes("--dry-run");
if (!scenario) throw new Error("Usage: tsx ops/incident-response/orchestrator.ts <scenario> [--dry-run]");

const catalog = JSON.parse(await readFile("ops/incident-response/runbooks.json", "utf8")) as Catalog;
const runbook = catalog.runbooks[scenario];
if (!runbook) throw new Error(`Unknown incident scenario: ${scenario}`);

for (const action of runbook.containment) {
  const command = actions[action];
  if (!command) throw new Error(`Action is not allowlisted: ${action}`);
  process.stdout.write(`${dryRun ? "DRY RUN " : ""}${command[0]} ${command[1].join(" ")}\n`);
  if (!dryRun) await execFileAsync(command[0], command[1]);
}

process.stdout.write(`Evidence collection queued for ${scenario} (${runbook.severity})\n`);
