## Pull Request Checklist

Please ensure your PR follows these steps, mirroring our `CONTRIBUTING.md` guidelines.

- [ ] I have read the `CONTRIBUTING.md` document.
- [ ] My code follows the code style of this project.
- [ ] I have added tests to cover my changes.
- [ ] All new and existing tests passed.
- [ ] I have updated the documentation accordingly.
- [ ] I have verified the changes locally.
- [ ] For security-sensitive changes, I have attached a completed `.github/THREAT_MODEL.md` and requested security champion review.
- [ ] Security gates have passed, or any findings are documented and reviewed.

## Linked Issue

<!-- Close the relevant issue (e.g., `Closes #123`) -->
Closes #

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Refactor / Code cleanup
- [ ] Performance improvement
- [ ] Test addition / improvement
- [ ] Chore (build, deps, tooling)

## Component Affected

- [ ] `[backend]` API routes, services, middleware, database logic
- [ ] `[contracts]` Soroban/Rust smart contracts, money policy
- [ ] `[frontend]` Next.js/React UI, i18n, client-side flows
- [ ] `[sdk]` TypeScript SDK package (`sdk/`)
- [ ] `[indexer]` Event indexer tooling (`indexer/`, indexer services)
- [ ] `[scripts]` Deploy, tooling, and load-test scripts (`scripts/`)
- [ ] `[docs]` Documentation, wiki, API docs, Swagger/OpenAPI alignment
- [ ] `[ci]` CI/CD workflows, badges, supply-chain checks
- [ ] `[infra]` Docker, environment/config drift, deployment infrastructure
- [ ] `[security]` Secrets, PII crypto, signing, compliance, sanctions screening
- [ ] `[tests]` Test suites, parity tests, E2E coverage, load-test baselines
- [ ] `[ops]` Operations tooling, monitoring, admin dashboards
- [ ] `[product]` Cross-cutting product flows spanning multiple components

## Testing

<!-- Evidence that the changes were tested -->

### Test Commands Run

```bash
# Example:
cd frontend && npm run lint && npm run test
cd backend && npm run lint && npm run test
cd contracts && cargo fmt --check && cargo clippy && cargo test
```

### Test Results

- [ ] All existing tests pass
- [ ] New tests added for new functionality
- [ ] Manual testing completed (describe below)

**Manual testing notes:**

---

## Checklist

- [ ] Code follows project style guides ([CONTRIBUTING.md](../../CONTRIBUTING.md))
- [ ] Tests have been added/updated and pass
- [ ] Documentation has been updated (if applicable)
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] No console.log / debug statements left in code
- [ ] No hardcoded secrets or credentials
- [ ] Environment variables documented in `.env.example` and `docs/ENVIRONMENT.md` (if new vars added)

## Screenshots / Demo (if UI changes)

<!-- Add screenshots or a short demo video link -->

---

💬 **Questions?** Join the conversation on [Telegram](https://t.me/+eRqhka27TVo0NzM8) — fellow contributors and maintainers hang out there.
