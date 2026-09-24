# Contributor Onboarding

Welcome to DukaPay! This checklist gets a new contributor from clone to first
merged PR.

## 1. Accounts & access

- [ ] GitHub access to `ExcelDsigN-tech/dukapay`
- [ ] Joined the [Telegram community](https://t.me/+eRqhka27TVo0NzM8)
- [ ] Read `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`
- [ ] Read `ARCHITECTURE.md` and `docs/wiki/architecture.md`

## 2. Local environment

```bash
# Prerequisites
nvm use                  # picks the repo Node version
rustup toolchain install 1.85.0 --target wasm32-unknown-unknown
cargo install --locked soroban-cli  # matches contracts/rust-toolchain.toml

# Frontend
cd frontend && npm ci && npm run dev

# Backend
cd backend && npm ci && npm run dev

# Contracts
cd contracts && cargo build --target wasm32-unknown-unknown --release
```

## 3. First test run

```bash
cd contracts && cargo test            # Rust / Soroban contracts
cd frontend && npm run lint && npm run test
cd backend  && npm run lint && npm run test
```

## 4. Branch & commit conventions

- Branch: `feat/<short>`, `fix/<short>`, `docs/<short>`, `security/<short>`,
  `contracts/<short>`, etc. (see `CONTRIBUTING.md`).
- Commits: Conventional Commits (`feat(contracts): ...`).
- PR must `Closes #<issue>` and include testing evidence.

## 5. Where things live

| Area | Path |
| --- | --- |
| Smart contracts | `contracts/` (Soroban/Rust) |
| Contract wiki | `docs/wiki/` |
| Security model | `docs/SECURITY-MODEL.md`, `docs/security/` |
| API / env reference | `docs/ENVIRONMENT.md` |
| Deploy scripts | `scripts/` |
| Runbooks | `docs/runbooks/`, `docs/wiki/deployment.md` |

## 6. First good contributions

- Add a unit test for an existing invariant in `contracts/*/src/test.rs`.
- Improve a doc page in `docs/wiki/`.
- Triage a `good first issue` from the tracker.

## 7. Security-sensitive changes

For auth, payments, secrets, or contract changes: complete the STRIDE
analysis in `.github/THREAT_MODEL.md`, run `pre-commit run --all-files`, and
request a security-champion review.

## 8. Verify before pushing

```bash
cd contracts && cargo fmt --check && cargo clippy && cargo test
```
