# Security Policy

For the authentication and authorization model (roles, scopes, JWT flow,
API-key namespaces, cookie attributes, and route guards) see
[docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).

## Supported Versions

Only the current `main` branch and the last tagged release are supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| Main    | :white_check_mark: |
| Last Tag| :white_check_mark: |
| Older   | :x:                |

## Reporting a Vulnerability

We take the security of our smart contracts, backend, and frontend seriously.

**Please do not report security vulnerabilities through public GitHub issues.**

If you believe you have found a security vulnerability, please contact us directly to request a private, encrypted channel for full disclosure.

### What to include

*   A description of the vulnerability and its impact.
*   Steps to reproduce the vulnerability.
*   Any relevant logs or output.

### Scope

*   **In-Scope:** Smart contracts, backend, and frontend code contained in this repository.
*   **Out-of-Scope:** Third-party services, dependencies, and infrastructure not managed directly by this repository.

### Response and Disclosure

*   We aim to respond to all vulnerability reports within **5 business days**.
*   We request a **90-day disclosure window** to give us time to investigate and patch the vulnerability before it is publicly disclosed.
*   At this time, we do not offer a paid bounty program, but we appreciate and may acknowledge responsible disclosures.

## Safe Harbor

We support safe harbor for security researchers who:

1. Make a good faith effort to avoid privacy violations, data destruction, or disruption to our services.
2. Only interact with accounts you own or with explicit permission of the account holder.
3. Do not exploit a vulnerability beyond what is necessary to confirm its existence.
4. Report vulnerabilities promptly and do not publicly disclose them before a fix is deployed.

We will not pursue legal action against researchers who follow these guidelines.

---

## Penetration Testing Program

### Annual External Pentest

DukaPay undergoes an annual external penetration test conducted by a qualified
third-party firm. The scope covers:

- **Smart Contracts:** Soroban contract logic, invariant enforcement, access controls
- **Backend API:** Authentication, authorization, injection, business logic
- **Frontend:** XSS, CSRF, authentication bypass, client-side vulnerabilities
- **Infrastructure:** Network configuration, container security, secrets management

**Frequency:** Annual (minimum), with additional tests after major releases.

### Continuous Bug Bounty Program

DukaPay operates a continuous bug bounty program to complement scheduled pentests.

**Rewards:**

| Severity | Reward Range | Description |
|----------|-------------|-------------|
| Critical | $10,000 - $100,000 | Smart contract exploits, fund theft, private key exposure |
| High | $5,000 - $10,000 | Authentication bypass, privilege escalation, SQL injection |
| Medium | $1,000 - $5,000 | XSS, CSRF, information disclosure, rate limiting bypass |
| Low | $100 - $1,000 | Minor information leaks, best practice violations |

**Eligibility:**

- First reporter of a previously unknown vulnerability
- Vulnerability must be reproducible
- Must not have been previously reported
- Must follow responsible disclosure process

**Exclusions:**

- Known issues listed in our issue tracker
- Social engineering attacks
- Denial of service attacks
- Attacks requiring physical access to user devices

### Quarterly Red Team Exercises

Internal red team exercises are conducted quarterly to test:

1. **Incident Response:** Time to detect and respond to simulated attacks
2. **Access Controls:** Attempt to escalate privileges across contract/backend/frontend
3. **Financial Controls:** Attempt to manipulate loan/float/settlement logic
4. **Data Exfiltration:** Test PII protection and encryption at rest

**Schedule:** Q1 (January), Q2 (April), Q3 (July), Q4 (October)

Results are reviewed by the security champion team and tracked in the issue tracker.

---

## Automated Security Scanning

### Static Application Security Testing (SAST)

- **Semgrep:** Runs on every PR and push to main (pinned version: v1.174.0)
- **CodeQL:** Weekly analysis for JavaScript/TypeScript and Rust with `security-and-quality` queries
- **Clippy (Rust):** Enforced in CI with all default and selected lint groups

### Dynamic Application Security Testing (DAST)

- **OWASP ZAP:** Scheduled weekly scans against the staging API
- **API Schema Validation:** OpenAPI spec validated against security best practices

### Dependency Scanning

- **npm audit:** Runs on every PR for backend and frontend
- **cargo audit:** Runs on every PR for smart contracts
- **Trivy:** Filesystem scanning for vulnerabilities, secrets, and misconfigurations
- **Gitleaks:** Secret detection in git history on every PR

### Supply Chain Security

- Lockfile integrity checks against known compromised packages
- SHA-pinned GitHub Actions to prevent tag-based supply chain attacks
- SLSA build provenance attestation for WASM contract artifacts

---

## Security Headers

The backend API enforces the following security headers via Helmet:

- **Content Security Policy (CSP):** Restricts resource loading to same-origin
- **Strict Transport Security (HSTS):** 1-year max-age with subdomain inclusion and preload
- **X-Content-Type-Options:** nosniff
- **X-Frame-Options:** DENY
- **Referrer-Policy:** strict-origin-when-cross-origin

---

## Incident Response

1. **Detection:** Automated monitoring (Sentry, Prometheus) + manual reports
2. **Triage:** Security champion evaluates severity within 24 hours
3. **Containment:** Hotfix deployed, affected users notified if PII exposed
4. **Eradication:** Root cause analysis, vulnerability patched
5. **Recovery:** Service restored, monitoring enhanced
6. **Lessons Learned:** Post-mortem documented, controls updated

---

## Security Champions

See [SECURITY_CHAMPIONS.md](.github/SECURITY_CHAMPIONS.md) for the security
champion program and review triggers.
