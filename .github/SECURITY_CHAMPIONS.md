# Security Champions

Each team should nominate at least one security champion for every release cycle. Champions help feature owners complete threat models, identify security-sensitive changes, and route reviews to the right maintainer. They do not replace code ownership or specialist security review.

## Responsibilities

- Review STRIDE threat models for changes in the team's area.
- Confirm security tests and CI results are present before approval.
- Keep the team current on annual secure-development training.
- Escalate unresolved risks to the maintainers and security contact in [SECURITY.md](../SECURITY.md).

## Nomination

Record the current champions in the teams private engineering roster. Do not put personal contact details, credentials, or incident information in this repository. The maintainer responsible for each component is the fallback champion when a team has not nominated one.

## Review Triggers

Request champion review when a pull request changes authentication, authorization, payments, smart contracts, PII, secrets, dependency policy, or deployment/network boundaries. Use [THREAT_MODEL.md](THREAT_MODEL.md) to document the decision.
