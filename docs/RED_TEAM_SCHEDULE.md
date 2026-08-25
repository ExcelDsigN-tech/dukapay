# DukaPay Red Team Exercise Schedule

## Overview

DukaPay conducts quarterly internal red team exercises to test our security
posture, incident response capabilities, and defensive controls. These exercises
are conducted by the security champion team in coordination with external
consultants when appropriate.

## Exercise Schedule

### Q1 (January) — Smart Contract Focus

**Duration:** 2 weeks
**Scope:** All Soroban smart contracts

| Day | Activity | Team |
|-----|----------|------|
| 1-2 | Threat modeling & attack tree creation | Security + Dev |
| 3-5 | Smart contract fuzzing (property-based) | Security |
| 6-8 | Manual code review & exploit development | Security |
| 9-10 | Invariant violation attempts | Security |
| 11-12 | Cross-contract interaction testing | Security + Dev |
| 13-14 | Documentation & remediation planning | All |

**Key Tests:**
- Float invariant bypass attempts
- Unauthorized collateral withdrawal
- Flash loan attack simulations
- Oracle manipulation scenarios
- Access control escalation

### Q2 (April) — Backend API Focus

**Duration:** 1 week
**Scope:** Express API, authentication, authorization

| Day | Activity | Team |
|-----|----------|------|
| 1 | Authentication bypass attempts | Security |
| 2 | Authorization & privilege escalation | Security |
| 3 | Injection attacks (SQL, NoSQL, XSS) | Security |
| 4 | Business logic flaws | Security + Dev |
| 5 | Rate limiting & DoS resistance | Security |
| 6-7 | Report writing & remediation | All |

**Key Tests:**
- JWT token manipulation
- Role-based access control bypass
- PII extraction attempts
- IDOR vulnerability testing
- Race condition exploitation

### Q3 (July) — Frontend & Integration Focus

**Duration:** 1 week
**Scope:** Next.js frontend, wallet integration, API integration

| Day | Activity | Team |
|-----|----------|------|
| 1 | Client-side vulnerability scanning | Security |
| 2 | Wallet integration security review | Security + Dev |
| 3 | XSS & CSRF testing | Security |
| 4 | Transaction signing security | Security + Dev |
| 5 | Data leakage assessment | Security |
| 6-7 | Report writing & remediation | All |

**Key Tests:**
- Transaction signing bypass
- Private key exposure vectors
- Cross-origin attack testing
- Local storage data exposure
- Service worker security

### Q4 (October) — Infrastructure & Incident Response

**Duration:** 1 week
**Scope:** Docker, CI/CD, deployment, monitoring

| Day | Activity | Team |
|-----|----------|------|
| 1 | Container security assessment | Security |
| 2 | CI/CD pipeline security review | Security + DevOps |
| 3 | Secrets management audit | Security |
| 4 | Incident response drill | All |
| 5 | Recovery & backup testing | DevOps |
| 6-7 | Final report & annual review | All |

**Key Tests:**
- Container escape attempts
- Supply chain attack simulations
- Secrets exposure scanning
- Incident response time measurement
- Disaster recovery validation

## Exercise Rules of Engagement

1. **Authorization:** All exercises must be authorized by the security lead
2. **Scope:** Only test in-scope systems; no production user data access
3. **Documentation:** All findings documented with reproduction steps
4. **Immediate Reporting:** Critical findings reported immediately to security lead
5. **No Destruction:** Do not destroy data or disrupt services
6. **Confidentiality:** Exercise results are confidential

## Reporting

Each exercise produces:

1. **Executive Summary:** High-level findings for leadership
2. **Technical Report:** Detailed vulnerability descriptions
3. **Remediation Plan:** Prioritized fix recommendations
4. **Metrics:** Time to detect, time to respond, vulnerabilities found

## Metrics Tracked

| Metric | Target | Current |
|--------|--------|---------|
| Mean Time to Detect (MTTD) | < 24 hours | TBD |
| Mean Time to Respond (MTTR) | < 48 hours | TBD |
| Critical Vulnerabilities Found | 0 | TBD |
| High Vulnerabilities Found | < 3 | TBD |
| Fix Deployment Time (Critical) | < 48 hours | TBD |
| Fix Deployment Time (High) | < 7 days | TBD |

## Review Cadence

- **After Each Exercise:** Team retrospective (30 min)
- **Quarterly:** Security metrics review with leadership
- **Annually:** Full program assessment and budget review

---

*Last updated: August 2026*
