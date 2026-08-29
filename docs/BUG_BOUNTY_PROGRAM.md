# DukaPay Bug Bounty Program

## Overview

DukaPay operates a continuous bug bounty program to identify and remediate
security vulnerabilities before they can be exploited. We reward security
researchers who responsibly disclose vulnerabilities in our platform.

## Program Scope

### In-Scope Targets

| Target | Type | Details |
|--------|------|---------|
| Smart Contracts | Soroban/Rust | agent_vault, loan_manager, lending_pool, remittance_nft, agent_registry, multisig_governance |
| Backend API | Node.js/Express | All endpoints under `/api/` and `/api/v1/` |
| Frontend | Next.js/React | Web application at dukapay.com |
| Infrastructure | Docker/K8s | Deployment configurations, CI/CD pipelines |

### Out-of-Scope

- Third-party services (Stellar network, SendGrid, Twilio, Redis, PostgreSQL)
- Social engineering attacks
- Denial of service attacks
- Physical attacks
- Attacks requiring compromised credentials (unless the vulnerability enables credential compromise)

## Reward Structure

### Smart Contract Vulnerabilities

| Severity | Reward | Examples |
|----------|--------|----------|
| Critical | $50,000 - $100,000 | Fund theft, invariant bypass, unauthorized minting, reentrancy |
| High | $10,000 - $50,000 | Access control bypass, oracle manipulation, flash loan attacks |
| Medium | $5,000 - $10,000 | Integer overflow, front-running, griefing attacks |
| Low | $1,000 - $5,000 | Gas griefing, timestamp dependence, minor logic issues |

### Backend API Vulnerabilities

| Severity | Reward | Examples |
|----------|--------|----------|
| Critical | $10,000 - $50,000 | Remote code execution, SQL injection with data exfiltration |
| High | $5,000 - $10,000 | Authentication bypass, privilege escalation, SSRF |
| Medium | $1,000 - $5,000 | XSS, CSRF, information disclosure, IDOR |
| Low | $100 - $1,000 | Missing headers, verbose errors, rate limiting bypass |

### Frontend Vulnerabilities

| Severity | Reward | Examples |
|----------|--------|----------|
| Critical | $5,000 - $20,000 | Wallet private key extraction, transaction signing bypass |
| High | $2,000 - $5,000 | Stored XSS, OAuth bypass, session fixation |
| Medium | $500 - $2,000 | Reflected XSS, clickjacking, open redirect |
| Low | $100 - $500 | Missing security headers, information leakage |

## Submission Guidelines

### How to Report

1. Email: security@dukapay.com
2. Include "Vulnerability Report" in the subject line
3. Use our PGP key for encrypted communications (see below)

### What to Include

- **Description:** Clear explanation of the vulnerability
- **Impact:** What an attacker could achieve
- **Reproduction Steps:** Step-by-step instructions to reproduce
- **Proof of Concept:** Code, screenshots, or videos demonstrating the issue
- **Suggested Fix:** If you have a recommendation for remediation

### Response Timeline

| Stage | Timeline |
|-------|----------|
| Acknowledgment | Within 3 business days |
| Initial Assessment | Within 7 business days |
| Validation & Triage | Within 14 business days |
| Fix Deployment | Critical: 48 hours, High: 7 days, Medium: 30 days |
| Disclosure | 90 days after fix deployment |

## Safe Harbor

We support safe harbor for security researchers:

1. **Good Faith:** We will not pursue legal action against researchers who make a good faith effort to avoid privacy violations, data destruction, or service disruption.
2. **Authorization:** We authorize testing against in-scope targets during the program.
3. **No Credential Abuse:** Do not access accounts you do not own without explicit permission.
4. **Report First:** Report vulnerabilities before public disclosure.
5. **Minimal Impact:** Do not exploit vulnerabilities beyond what is necessary to confirm their existence.

## Exclusion Criteria

The following are not eligible for rewards:

- Vulnerabilities already known or reported by another researcher
- Issues requiring physical access to user devices
- Social engineering attacks
- Denial of service attacks
- Attacks against third-party infrastructure
- Issues in deprecated or unmaintained code
- Theoretical vulnerabilities without demonstrated impact

## Responsible Disclosure

We request a **90-day disclosure window** from the date of the initial report.
This allows us to:

1. Validate the vulnerability
2. Develop and test a fix
3. Deploy the fix to production
4. Verify the fix is effective

## Contact

- **Email:** security@dukapay.com
- **PGP Key:** Available at https://dukapay.com/security/pgp-key.txt
- **Emergency:** For active exploitation, contact security-urgent@dukapay.com

---

*Last updated: August 2026*
