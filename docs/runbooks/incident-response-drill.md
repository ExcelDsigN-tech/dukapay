# Monitoring Verification & Incident-Response Drill

Staging validation for the Prometheus/Grafana/Alertmanager stack
(`ops/monitoring/`) and the incident-response runbooks
(`ops/incident-response/`). Run before mainnet; repeat in the Q4
infrastructure week per `SECURITY.md` and `docs/RED_TEAM_SCHEDULE.md`.

## 1. Monitoring verification (reuse `tests/load/` — no new tooling)

1. Start staging plus monitoring:
   `docker compose -f docker-compose.staging.yml up -d` then
   `docker compose -f ops/monitoring/docker-compose.monitoring.yml up -d`.
2. Run one load scenario, e.g. `TEST_ENV=staging k6 run scenarios/api-read.js`
   from `tests/load/` (profiles: `smoke` → `normal` → `stress`).
3. While it runs, watch Grafana (`:3000`, `web-performance` dashboard) and
   Prometheus (`:9090`) / Alertmanager (`:9093`) and confirm:
   - `HighLatency` (P99 > 2s, 5m) and `HighErrorRate` (> 1% 5xx, 2m) trip
     under `stress`/`spike` and clear afterwards;
   - `IndexerLagHigh` (`indexer_lag_ledgers > 100`, 5m) trips when the
     indexer is paused or the RPC is pointed at a lagging node, and clears
     after resume (procedure: `docs/runbooks/indexer-recovery.md`);
   - `HighFloatUtilization` / `LowRepaymentRate` / `HighDefaultRate` evaluate
     without "no data" gaps (business metrics exported).
4. Record the run date, scenario, profile, and which alerts fired in the
   Q4 drill report. Fix thresholds/dashboards in `alerts.yml` first if an
   expected alert does not fire — do not just note it.

## 2. Incident-response dry-run

```bash
npx tsx ops/incident-response/orchestrator.ts ddos --dry-run
npx tsx ops/incident-response/orchestrator.ts contract-exploit --dry-run
```

Expected: each containment action prints as `DRY RUN kubectl …`, followed by
`Notify: <groups>` and one `Evidence: <item>` line per evidence entry.
No cluster mutation happens under `--dry-run`. The `data-breach` and
`insider-threat` scenarios exercise `verify_database_access_policy` (read-only
`kubectl get networkpolicy allow-db-access`, policy defined in
`infra/kubernetes/zero-trust/policies.yaml`), which previously threw
`Action is not allowlisted` before the allowlist + policy were added.

## 3. On-call ownership

- Paging groups are defined in `ops/incident-response/runbooks.json`
  (`security-oncall`, `engineering-leads`, `legal`, `executive`,
  `communications`) and routed via Alertmanager to `#dukapay-critical` /
  `#dukapay-warnings` plus PagerDuty (`PAGERDUTY_SERVICE_KEY`).
- Human ownership: the security champion team triages within 24h
  (`SECURITY.md` Incident Response); individual contacts stay in the private
  roster per `.github/SECURITY_CHAMPIONS.md` and are never committed.
- Cadence: Q4 incident-response drill yearly at minimum
  (`docs/RED_TEAM_SCHEDULE.md` Day 4–5), plus this pre-mainnet dry-run.
