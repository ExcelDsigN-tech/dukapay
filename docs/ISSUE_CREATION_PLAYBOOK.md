# Issue Creation Playbook

Universal template for drafting and filing issues on the DukaPay repo — used for
one-off issues and for batch/bulk drafting passes alike.

## Key Context — DukaPay Monorepo

- **Protocol:** On-chain agent-banking float protocol on Stellar (Soroban)
- **Core Invariant:** Σ float ≤ Σ collateral × haircut
- **Stack:** Node.js/Express API (`backend/`), Next.js/React (`frontend/`), Soroban/Rust contracts (`contracts/`), TypeScript SDK (`sdk/`), PostgreSQL
- **Key Flows:** Agent onboarding (KYC + USDC bond), cash-in/out, float transfers, loan management, settlement
- **Security Model:** JWT auth, session management, CSRF protection, audit logging, encryption at rest
- **Testing:** Playwright E2E, Proptest property-based, Supertest integration, fuzz testing
- **Repo Root:** `{REPO_PATH}` — set per environment (env var or CLI arg), no hardcoded default
- **Issue Templates:** `.github/ISSUE_TEMPLATE/` (standard, bug_report, feature_request, contracts_security, question, config)

## Analysis Phase (Do First)

Gather evidence and classify severity — the goal is accurate findings, not a
point total.

```bash
# 1. Dedup against existing open issues
gh issue list --state open --limit 100 --json number,title,body,labels

# 2. Confirm labels exist before batch creation (create any missing ones now)
gh label list

# 3. Surface-level gaps (candidates for the 100/150 tier)
grep -r "TODO\|FIXME\|XXX" --include="*.ts" --include="*.rs" --include="*.js" {REPO_PATH}
grep -r "sk-\|api_key\|password" --include="*.ts" --include="*.rs" {REPO_PATH} | head -20
find {REPO_PATH} -name "*.test.*" -o -name "*.spec.*" | wc -l

# 4. Protocol-depth review (genuine 200-point candidates come from here, not from grep)
#    - Read contracts/ for: overflow/underflow paths, access control gaps, reentrancy,
#      and any code path that could violate Σ float ≤ Σ collateral × haircut
#    - Read auth/session/settlement flows in backend/ for the same class of issue
#    - If this pass finds few or no invariant-breaking bugs, report that honestly —
#      don't inflate other findings to compensate

# 5. Recent commits, for context on what's already in flight
git log --oneline -50 -- {REPO_PATH}
```

## Output Format — Exact Template (Non-Negotiable)

```
[{COMPONENT}] {DESCRIPTION}

**Description**: {DESCRIPTION}

**Impact**: {IMPACT}

**Suggested Fix**: {SUGGESTED_FIX}

**Points**: {POINTS}
**Type**: {TYPE}

**Definition of Done**
- [ ] {CHECKLIST_ITEM_1}
- [ ] {CHECKLIST_ITEM_2}
- [ ] {CHECKLIST_ITEM_3}
- [ ] {CHECKLIST_ITEM_4}
      (can be more than 4 items, based on the issue)
- [ ] All necessary CI checks passed

---

📋 Before working on this issue, please read our [Contributing Guidelines]({CONTRIBUTING_URL}) — it covers branching, commits, PR standards, testing, and style guides.

🎯 To claim this issue: comment below before starting work. First contributor comment gets it for the current Drip Wave cycle. If it's not merged by cycle end, it reopens for the next cycle.

Join our Telegram community to connect with other contributors, ask questions, and stay updated:

💬 Telegram: https://t.me/+eRqhka27TVo0NzM8

All official decisions, reviews, and coordination happen right here on GitHub. The Telegram group is a space for informal discussion and peer support.
```

### Component Prefixes (Use Exactly One)

`[backend]` `[contracts]` `[frontend]` `[sdk]` `[indexer]` `[scripts]` `[docs]` `[ci]` `[infra]` `[security]` `[tests]` `[ops]` `[product]`

### Points & Types

| Points | Complexity |
|---|---|
| 200 | High — critical security, core bugs, consensus changes |
| 150 | Medium-High — enhancements, security updates, test suites |
| 100 | Trivial/Simple — docs, cosmetic, config |

### Target Distribution

No fixed quota. Scope target: roughly 60 issues total, but each issue's point
value is earned against the table above, not fit to a bucket count.

- Assign 200 only if it's genuinely high complexity — don't downgrade a real
  200 for variety, and don't upgrade a medium one just for volume.
- If the protocol-depth review turns up fewer critical issues than expected,
  report the real count and say why.
- After drafting, report the actual breakdown (e.g. "18×200 / 27×150 /
  15×100") — the distribution is a finding, not an input.

### Definition of Done — Component-Specific (pick one set)

- **Security:** No hardcoded secrets remain in source (grep scan clean) · Authentication flow verified and tested · Security headers (CSP, etc.) configured · No PII exposed in logs or error messages
- **Bug:** Bug reproduced and root cause identified · Fix implemented and tested · Edge cases covered by existing tests · No regression introduced
- **Enhancement:** Documentation verified · Lint + typecheck pass
- **Documentation:** Documentation complete and accurate · Examples and tutorials updated · Cross-reference checks complete
- **Performance:** Performance improvements implemented · Benchmarks run and passing · No regressions in performance-critical paths
- **Always last:** All necessary CI checks passed

### Placeholders (Fill Before Execution)

| Placeholder | Description |
|---|---|
| `{REPO_PATH}` | Absolute path to repo root (set per environment, no default) |
| `{COMPONENT}` | One of the 13 prefixes above |
| `{DESCRIPTION}` | One-line issue title |
| `{IMPACT}` | Business/technical impact |
| `{SUGGESTED_FIX}` | Concrete implementation approach |
| `{POINTS}` | 200 \| 150 \| 100 |
| `{TYPE}` | security \| bug \| enhancement \| tests \| documentation \| performance |
| `{CONTRIBUTING_URL}` | Link to the repo's CONTRIBUTING.md or equivalent |
| `{CHECKLIST_ITEM_N}` | Pulled from the component-specific list above |

## Execution

Single issue:

```bash
gh issue create \
  --title "[{COMPONENT}] {DESCRIPTION}" \
  --body "$(cat issue_body.md)" \
  --label "{COMPONENT}" \
  --label "{TYPE}"
```

Batch: `create_issues.py` reads a manifest (JSON/YAML list of `{component,
description, impact, fix, points, type, checklist}`), renders each into the
template above, and loops `gh issue create` with the matching labels.
Prerequisite: `gh label list` must already contain every component/type label
used — create any missing ones first.

```bash
python create_issues.py
```

## Tone

Professional, precise, structured. Zero fluff. Every field serves a purpose.
No deviation from the template.

## Clarifying Questions (ask if needed)

1. Prioritize security over features? (Default: Yes)
2. Run duplicate detection against existing issues? (Default: Yes)
3. Auto-assign component/type labels? (Default: Yes)
4. Create milestones per point tier? (Default: No)

## Sample Issue (for calibration)

`[backend] Lender role has no distinct Row-Level Security policy family`

**Description:** `backend/src/auth/rbac.ts` defines 5 roles: `admin`, `agent`,
`borrower`, `auditor`, `lender`. The RLS migration
(`backend/migrations/1808000000000_enable-rls.cjs`) only builds policy
families for 4 of them: `borrower` (own rows), `agent` (own + assigned
borrowers via `agent_assignments`), `auditor` (read-only, all rows), `admin`
(unrestricted). `lender` has no corresponding `dukapay_request_is_lender()`-
style policy — it's unclear whether lender requests fall through
agent-shaped policies, borrower-shaped policies, or are default-denied by
Postgres RLS (deny-by-default when no policy matches).

**Impact**: If a lender-scoped request reaches a table with RLS enabled and no
matching policy, Postgres silently returns zero rows rather than erroring —
this could look like "the pool has no data" instead of a clear
access-control message, and could equally mask an unintended over- or
under-grant.

**Suggested Fix**: Trace what actually happens today for a lender-authenticated
request against an RLS-protected table (test it directly, don't assume). If
`lender` is meant to be a read-only alias of `agent` (per the comment in
`rbac.ts`), add an explicit RLS policy rather than relying on incidental
behavior. Add a test case alongside the existing `tenantAccessRbac.test.ts`
suite covering the lender role specifically.

**Points**: 150
**Type**: security

**Definition of Done**
- [ ] Actual current behavior for lender-role RLS access confirmed and documented
- [ ] Explicit RLS policy added for lender (or the role formally deprecated in favor of agent)
- [ ] Test coverage added for lender-role row access
- [ ] All necessary CI checks passed

---

📋 Before working on this issue, please read our [Contributing Guidelines]({CONTRIBUTING_URL}) — it covers branching, commits, PR standards, testing, and style guides.

🎯 To claim this issue: comment below before starting work. First contributor comment gets it for the current Drip Wave cycle. If it's not merged by cycle end, it reopens for the next cycle.

Join our Telegram community to connect with other contributors, ask questions, and stay updated:

💬 Telegram: https://t.me/+eRqhka27TVo0NzM8

All official decisions, reviews, and coordination happen right here on GitHub. The Telegram group is a space for informal discussion and peer support.
