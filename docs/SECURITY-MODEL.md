# DukaPay Authentication & Authorization Model

This document describes the security model for the DukaPay backend API: how
identities are established, how roles map to scopes, and which scope guard
protects each route group. See also [SECURITY.md](../SECURITY.md) for the
vulnerability-disclosure policy.

---

## Authentication flows

### 1. Challenge–signature–JWT (primary, for wallet users)

1. **GET /api/auth/challenge?publicKey=G…** — server returns a one-time nonce
   message valid for 5 minutes.
2. Client signs the message with the Stellar Ed25519 private key.
3. **POST /api/auth/verify** — server verifies the signature via
   `Keypair.verify`, resolves the role for that public key (see [Role
   resolution](#role-resolution) below), and mints a JWT.
4. The JWT is returned both in the JSON body and set as a `httpOnly`,
   `SameSite=strict` cookie named `dukapay_jwt` (overridable via
   `JWT_COOKIE_NAME` env var). The cookie is used for SSE/EventSource
   connections that cannot attach `Authorization` headers.
5. JWT lifetime: **24 hours** (`JWT_EXPIRES_IN = "24h"`).
   Secret: `JWT_SECRET` environment variable (required).

JWT payload shape (`JwtPayload` in `authService.ts`):

```ts
{
  publicKey: string;   // Stellar G… address
  role: UserRole;      // "admin" | "borrower" | "lender"
  scopes: string[];    // derived from role via ROLE_SCOPES
  iat: number;
  exp: number;
}
```

Subsequent requests supply the JWT via:
- `Authorization: Bearer <token>` header, or
- the `dukapay_jwt` cookie.

### 2. API-key authentication (for backend services / admin tooling)

Admin operations use `x-api-key: <key>` instead of JWTs. Keys are configured
in the `INTERNAL_API_KEY` environment variable as a comma-separated list.

Key formats:

| Format | Example | Grants |
|---|---|---|
| Legacy (no scope prefix) | `mysecretkey` | All admin scopes |
| Scoped | `admin:disputes:mysecretkey` | Only `admin:disputes` |

Available scopes: `admin:disputes`, `admin:indexer`, `admin:webhooks`,
`admin:loans`.

Implemented in `backend/src/middleware/auth.ts` (`requireApiKey`).

---

## Role resolution

`resolveRoleForWallet(publicKey)` in `backend/src/auth/rbac.ts`:

1. If the public key is in `ADMIN_WALLETS` (comma-separated env) → **admin**.
2. If the public key is in `LENDER_WALLETS` → **lender**.
3. Otherwise → **borrower**.

---

## Role-to-scope table

Defined in `ROLE_SCOPES` in `backend/src/auth/rbac.ts`:

| Role | Scopes granted |
|---|---|
| `admin` | `admin:all` |
| `lender` | `read:loans`, `read:pool` |
| `borrower` | `read:loans`, `write:repayment`, `read:score`, `read:notifications`, `write:notifications` |

> **Note:** `lender` does **not** have `write:pool`. Pool write endpoints
> (`build-deposit`, `build-withdraw`, `build-emergency-withdraw`, `submit`)
> require `write:pool`, which means lenders currently receive 403 on those
> routes. This is a known gap tracked in issue #1179.

---

## Route-group authorization map

### JWT-authenticated routes (`requireJwtAuth` + `requireScopes`)

| Route group | Role check | Required scope |
|---|---|---|
| `GET /api/pool/stats` | `requireLender` | `read:pool` |
| `GET /api/pool/depositor/:address` | `requireLender` | `read:pool` |
| `GET /api/pool/depositor/:address/yield-history` | `requireLender` | `read:pool` |
| `GET /api/pool/:token/share-price` | `requireLender` | `read:pool` |
| `POST /api/pool/build-deposit` | `requireLender` | `write:pool` |
| `POST /api/pool/build-withdraw` | `requireLender` | `write:pool` |
| `POST /api/pool/build-emergency-withdraw` | `requireLender` | `write:pool` |
| `POST /api/pool/submit` | `requireLender` | `write:pool` |
| `GET /api/loans/*` | — | `read:loans` |
| `GET /api/indexer/loans/*` | — | `read:loans` |
| `GET/POST /api/notifications` | — | `read:notifications` / `write:notifications` |
| `POST /api/remittances` | — | `write:remittances` |
| `GET /api/remittances` | — | `read:remittances` |

### API-key-authenticated routes (`requireApiKey(scope)`)

| Route | Required scope |
|---|---|
| `GET /api/admin/loan-disputes` | `admin:disputes` |
| `POST /api/admin/loan-disputes/:id/resolve` | `admin:disputes` |
| `POST /api/admin/loans/check-defaults` | `admin:loans` |
| `GET /api/admin/indexer/*` | `admin:indexer` |
| `GET /api/events/status` | `admin:indexer` |
| `GET /api/indexer/events/recent` | `admin:indexer` |
| `GET/POST/DELETE /api/indexer/webhooks/*` | `admin:webhooks` |
| `GET/POST/DELETE /api/admin/webhooks/*` | `admin:webhooks` |

---

## PII field inventory

The following personally identifiable information (PII) fields are handled
across two layers. Fields marked **masked** are obfuscated for display on the
frontend (`frontend/src/app/utils/piiMask.ts`). Fields marked **encrypted** are
encrypted at rest on the backend (`backend/src/services/piiCrypto.ts`).

| Field | Frontend mask (`piiMask.ts`) | Backend encrypt (`piiCrypto.ts`) |
|-------|------------------------------|----------------------------------|
| Email | Yes — `maskRecipient(v, "email")` | Yes — `encryptField()` / `maskValue(v, "email")` |
| Phone | Yes — `maskRecipient(v, "phone")` | Yes — `encryptField()` / `maskValue(v, "phone")` |
| Name  | Yes — `maskRecipient(v, "name")`  | Yes — `encryptField()` / `maskValue(v, "name")` |
| Stellar address | Yes — `maskAddress(v)` | No (public by nature) |

Both `piiMask.ts` and `piiCrypto.ts` export a `maskValue` / `maskRecipient` for
email, phone, and name. The frontend uses `maskRecipient` from `piiMask.ts`;
the backend uses `maskValue` from `piiCrypto.ts`. The masking logic is
equivalent but maintained separately for each layer.

---

## Auth middleware stack

```
backend/src/middleware/jwtAuth.ts   — requireJwtAuth, requireLender,
                                      requireBorrower, requireScopes
backend/src/middleware/auth.ts      — requireApiKey (API-key scoped access)
backend/src/services/authService.ts — generateJwtToken, verifyJwtToken,
                                      generateChallenge, verifySignature
backend/src/auth/rbac.ts            — ROLE_SCOPES, resolveRoleForWallet,
                                      resolveScopesForRole
backend/src/middleware/rateLimit.ts — CSRF + tiered rate limiting
backend/src/services/piiCrypto.ts   — field-level PII encryption at rest
backend/src/services/piiRotation.ts — PII encryption-key rotation
```

---

## Encryption at rest (KEK/DEK)

The backend uses a **KEK/DEK envelope scheme** for PII stored in Postgres:

- **KEK (key encryption key):** `PII_ENCRYPTION_KEK`, a 32-byte Base64 key
  supplied via environment/vault. Never stored in the database.
- **DEK (data encryption key):** random 32-byte key generated per field row and
  stored **envelope-encrypted** with the KEK alongside the ciphertext. Losing
  the DEK invalidates only that field; rotating the DEK does not require
  re-encrypting other rows.
- **Cipher:** AES-256-GCM (128-bit tag, random 96-bit IV) via
  `crypto.createCipheriv` in `piiCrypto.ts` (`encryptField` / `decryptField`),
  with constants `AES_256_GCM_TAG_LENGTH = 16` and `IV_LENGTH = 12`.

Write path: `encryptField(plaintext)` → `{ iv, tag, ciphertext }` stored as a
single column. Database administrators without the KEK cannot recover
plaintext. Application logs **never** contain raw PII fields (all errors are
sanitized by `errorSanitizer` before logging, per issue #484).

### Key rotation (PII_REVISION)

`piiRotation.ts` implements `reEncryptPIIForAllUsers(state)`:

1. Read an envelope for each affected table.
2. Decrypt with the current KEK/DEK.
3. Re-encrypt with a fresh KEK/DEK.
4. Commit and update `PII_REVISION` (a monotonic counter tracked per record).

Rotation is run as a maintenance script with a dual-KEK window: keep the old
KEK active (for decryption) while records transition, and retire it once the
revision sweep reports zero records below the new revision.

`JWT_SECRET` rotation follows the same principle: JWTs are re-minted within 24h
(`JWT_EXPIRES_IN`), so a rolling rotation is inherently safe — see
`authService.rotateJwtSecret` equivalent flows in the auth middleware.

---

## Audit logging

Audit events are emitted for all security-relevant actions and shipped to the
audit store (backed by Postgres `audit_logs` + application logs → Sentry):

| Event | Trigger | Retention |
|---|---|---|
| `auth.challenge.issued` | GET `/api/auth/challenge` | 90 days |
| `auth.login.success` / `auth.login.failed` | POST `/api/auth/verify` | 90 days |
| `jwt.refreshed` / `jwt.revoked` | JWT refresh / revocation | 90 days |
| `csrf.token.rotated` | per-session CSRF rotation | 90 days |
| `admin.action` | any `admin:*` API-key route | 1 year |
| `webhook.delivered` / `webhook.failed` | outbound webhook dispatch | 90 days |
| `pii.encrypted` / `pii.rotated` | encryption & rotation ops | 1 year |

Audit record shape: `{ ts, actor (publicKey or apiKey-scope), action, scope,
route, outcome, request_id }`. Records are append-only and immutable; retention
is enforced by a scheduled purge (see `runbooks/`). The `request_id` links audit
entries to normalized (PII-free) request logs so an incident can be
reconstructed without exposing PII.

---

## Compliance mappings

| Requirement | Where satisfied |
|---|---|
| OWASP ASVS V2 (auth) | Challenge–signature–JWT, short-lived tokens, scoped API keys |
| OWASP ASVS V6 (PII) | Field-level AES-256-GCM encryption, masking in UI, `piiMask` |
| GDPR Art. 25 (DPA) | `docs/DPA_TEMPLATE.md`, PII inventory above, retention 90d–1y |
| PCI-DSS 3.4 (if storing card data) | N/A — DukaPay stores no card data; Stellar assets only |
| SOC 2 CC7 (monitoring) | Audit logging, Sentry, query-latency + security metrics |
| NIST SP 800-53 AC-2 (access) | RBAC scopes per route, role resolution, API-key scoping |

---

## Incident response playbook

1. **Detect** — Sentry alerts, audit-log anomaly checks, DAST/CodeQL findings
   (`.github/workflows/dast.yml`, `codeql.yml`), bug-bounty reports
   (`docs/BUG_BOUNTY_PROGRAM.md`).
2. **Verify** — reproduce and classify severity (SEV-1 PII/oracle/funds,
   SEV-2 availability, SEV-3 low). Use `request_id` links from the audit log to
   trace impact without exposing PII.
3. **Contain** — rotate `JWT_SECRET`, `INTERNAL_API_KEY`, and `PII_ENCRYPTION_KEK`;
   revoke impacted token families (`wiki/jwt-revocation.md`); pause failing
   admin key.
4. **Triage** — snapshot affected rows, run `reEncryptPIIForAllUsers` if key
   exposure implied, blocklist signatures if wallet compromise.
5. **Eradicate & recover** — apply patch behind the single-commit policy in
   `SECURITY.md`, validate with e2e + contract fuzz where relevant.
6. **Postmortem** — update `docs/SECURITY-MODEL.md`, threat model
   (`.github/THREAT_MODEL.md`), and Red Team schedule
   (`docs/RED_TEAM_SCHEDULE.md`); publish a summary to maintainers + Telegram.

---

## Cross-references

- [SECURITY.md](../SECURITY.md) — responsible disclosure + hardening policy
- `.github/THREAT_MODEL.md` — threat model
- `docs/DPA_TEMPLATE.md` — data-processing agreement template
- `docs/BUG_BOUNTY_PROGRAM.md` — bounty scope + rules
- `wiki/jwt-revocation.md` — token revocation procedure
- `docs/ENVIRONMENT.md` — env-var reference (`JWT_SECRET`, `INTERNAL_API_KEY`,
  `PII_ENCRYPTION_KEK`, rate-limit and CSRF knobs)
