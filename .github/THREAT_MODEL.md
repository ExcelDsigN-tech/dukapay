# Feature Threat Model

Complete this template for features that change authentication, authorization, payments, contracts, PII handling, external integrations, or deployment boundaries. Attach the completed model to the pull request and request review from a security champion.

## Scope and Data Flow

- Feature or change:
- Owner:
- Components and trust boundaries:
- Data stores and external services:
- Sensitive data involved:
- Authentication and authorization decisions:

## STRIDE Analysis

| Threat | Applicable? | Scenario | Mitigation | Verification |
| --- | --- | --- | --- | --- |
| Spoofing | Yes / No |  |  |  |
| Tampering | Yes / No |  |  |  |
| Repudiation | Yes / No |  |  |  |
| Information disclosure | Yes / No |  |  |  |
| Denial of service | Yes / No |  |  |  |
| Elevation of privilege | Yes / No |  |  |  |

## Abuse Cases and Residual Risk

- Abuse cases considered:
- Rate limits and failure behavior:
- Logging, alerting, and audit trail:
- Residual risks accepted and owner:

## Security Review

- [ ] Threat model covers every changed trust boundary.
- [ ] Security-sensitive assumptions have tests.
- [ ] A security champion reviewed this model.
- [ ] Follow-up issues were filed for unresolved risks.
