# @dukapay/sdk

TypeScript SDK for the [DukaPay](https://github.com/ExcelDsigN-tech/dukapay)
lending & remittance protocol.

- **`DukaPayClient`** — typed client for every API resource (loans, pool, scores, remittance, auth)
- **Wallet adapters** — `FreighterAdapter`, `AlbedoAdapter`, or your own via the `WalletAdapter` interface
- **`ContractHelpers`** — stroop/bps conversions, address formatting, network constants
- **React hooks** — `useWallet`, `useLoans`, `useFloat` (import from `@dukapay/sdk/react`)

## Install

```bash
npm install @dukapay/sdk
# React hooks additionally need: npm install react
# Freighter support: npm install @stellar/freighter-api  (already a dependency)
```

## Quick start

```ts
import { DukaPayClient, FreighterAdapter, ContractHelpers } from '@dukapay/sdk';

const client = new DukaPayClient({
  baseUrl: 'https://api.dukapay.io',
  network: 'mainnet',
  wallet: new FreighterAdapter(),
});

// Wallet login: connect → challenge → sign → session token (stored on the client)
await client.loginWithWallet();

// Typed calls
const me = await client.address();
const { items: loans } = await client.loans.list({ borrower: me! });

// Build + sign + submit a repayment
const unsigned = await client.loans.buildRepay(loans[0].id, ContractHelpers.toStroops('25'));
await client.signAndSubmit(unsigned, (xdr) => client.loans.submit(loans[0].id, xdr));
```

## React

```tsx
import { DukaPayProvider, useWallet, useLoans, useFloat } from '@dukapay/sdk/react';
import { FreighterAdapter } from '@dukapay/sdk';

const wallet = new FreighterAdapter();

function App() {
  return (
    <DukaPayProvider baseUrl="https://api.dukapay.io" network="mainnet" wallet={wallet}>
      <Dashboard />
    </DukaPayProvider>
  );
}

function Dashboard() {
  const { address, login, isAuthenticated } = useWallet(wallet);
  const { data: loans, isLoading } = useLoans();
  const float = useFloat(process.env.NEXT_PUBLIC_POOL_TOKEN!);

  if (!isAuthenticated) return <button onClick={login}>Connect</button>;
  return (
    <>
      <p>{address}</p>
      {isLoading ? 'Loading…' : <LoanList loans={loans} />}
      <p>Pool APY: {float.stats?.supplyApyBps}bps</p>
      <button onClick={() => float.deposit('100')}>Deposit 100</button>
    </>
  );
}
```

## Errors

Every call rejects with a `DukaPayError` carrying `status`, `code`, `requestId`
and `isRetryable`. GET requests are retried automatically (exponential backoff)
on `429`/`5xx`/network errors.

## Types

Domain types in `src/types.ts` are hand-maintained against
`backend/src/swagger`. Once the backend publishes an OpenAPI document, regenerate
with:

```bash
npx openapi-typescript https://api.dukapay.io/openapi.json -o src/generated.ts
```

## Versioning

Semantic versioning, released from `main` via
[semantic-release](https://semantic-release.gitbook.io/) driven by Conventional
Commits (`feat:` → minor, `fix:` → patch, `feat!:`/`BREAKING CHANGE` → major).

## Development

```bash
cd sdk
npm install
npm run build      # tsup → dist/ (ESM + CJS + d.ts)
npm run typecheck
npm test
```
