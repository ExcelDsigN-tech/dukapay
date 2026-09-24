# Key Ceremony Procedure

This procedure is used to provision **genesis** signing keys (the governance
admin 3-of-5 set and the deployer key) and for any full re-key. It enforces
multi-party control so no single operator ever sees or can reconstruct a key.

## Participants

- **Ceremony coordinator** (1) — runs the scripted steps, does not hold keys.
- **Key custodians** (≥3 independent) — each authorizes one share / quorum
  member. For the governance admin key, these are the 5 governance signers.
- **Observer / auditor** (1) — records the session, attests the outcome.

## Pre-conditions

- [ ] HSM/MPC account provisioned; API credentials are in the secret manager
      (never in `.env` or source).
- [ ] `DUKAPAY_PROVIDER` set; `scripts/key-management/provider.sh` reachable.
- [ ] A clean, audited machine or ephemeral enclave for the ceremony.
- [ ] Recording started; attestation template in `ops/`.

## Steps

1. **Generate inside the root of trust.** Each key is generated *within* the
   HSM/MPC. The plaintext key never exists.
   ```bash
   npx tsx scripts/key-management/provider.ts rotate <deployer|admin|oracle|operator>
   ```
   Capture the returned **opaque key reference** (ARN / vault id).

2. **Distribute references, not keys.** Each custodian receives only the
   reference and the corresponding **public** key. No secret material is
   shared.

3. **Threshold assembly (governance admin).** For the 3-of-5 admin key, each
   of the 5 custodians independently authorizes their share. The on-chain
   `MultisigGovernance` (and `CircuitBreaker` signer set) is initialized with
   the 5 public keys:
   ```bash
   # e.g. initialize the breaker with the 5 signers
   CircuitBreakerClient::initialize(admin, signers, 3, 86400)
   ```

4. **Attestation.** The coordinator writes `ops/key-ceremony-<date>.md`
   containing: key references, public keys, participant names, timestamp, and
   the observer's signature. Commit to the repo.

5. **Verification.** Run `scripts/key-management/scan-secrets.sh` — it must
   pass (only references present). Smoke-test signing with each key against a
   testnet contract.

## Post-ceremony

- Old keys (if re-keying) are **zeroized** in the HSM/MPC after the overlap
  grace period.
- Emergency revocation remains available via `emergency-revoke.sh`.
