# Changelog

All notable changes to `@dukapay/sdk` are documented here. This file is
maintained automatically by semantic-release.

## 0.1.0 (unreleased)

- Initial SDK: `DukaPayClient` with `auth`, `loans`, `pool`, `scores`,
  `remittance` resources.
- Wallet adapters: `FreighterAdapter`, `AlbedoAdapter`, `WalletAdapter` interface.
- `ContractHelpers` for stroop/bps/address conversions.
- React hooks: `DukaPayProvider`, `useWallet`, `useLoans`, `useFloat`.
- Automatic retry with backoff and normalised `DukaPayError`.
