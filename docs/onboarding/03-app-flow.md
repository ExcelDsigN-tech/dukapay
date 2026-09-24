# DukaPay — App Flow (Reverse-Engineered)

## Pages (frontend, all under `frontend/src/app/[locale]/`, i18n-routed)

| Route | Purpose |
|---|---|
| `/` | Landing / dashboard home (`page.tsx`, `LandingPage.tsx`) |
| `/loans` | Borrower's loan list (`LoanList.tsx`, `ActiveLoansTracker.tsx`) |
| `/loans/[loanId]` | Single loan detail |
| `/request-loan` | Loan application wizard (multi-step: amount/asset → collateral NFT → repayment schedule → final signature) |
| `/repay/[loanId]` | Repayment flow for a specific loan |
| `/lend` | Lending pool — deposit/withdraw, yield display (`LendPageClient.tsx`) |
| `/liquidations` | Liquidation monitoring (`LiquidationsClient.tsx`) |
| `/kingdom` | Gamification hub — XP, tiers, quests, achievements (`KingdomClient.tsx`) |
| `/analytics` | Financial performance dashboard, credit score / risk tier / yield charts |
| `/activity` | Transaction/activity history |
| `/remittances` | Remittance list |
| `/send-remittance` | Send a remittance |
| `/notifications` | Notification center (preferences, mark read) |
| `/wallet` | Wallet connection/management (Freighter) |
| `/settings` | User/profile settings |
| `/admin/disputes` | Admin: list loan disputes |
| `/admin/disputes/[id]` | Admin: adjudicate a single dispute |
| `/admin/governance` | Admin: contract-upgrade governance (approve/queue/cancel) |
| `/ui-demo` | Internal component showcase (dev-only, not a user-facing page) |

## Navigation Structure

- **Desktop**: left sidebar (`Sidebar.tsx`) — Home, Loans, Lend, Liquidations, Activity, Wallet, plus conditionally **Admin Disputes** for admin-scoped users.
- **Mobile**: bottom tab nav (`BottomNav.tsx`), same core items, condensed.
- Shared shell: `DashboardShell.tsx` wraps authenticated pages; `Header.tsx` holds notifications dropdown, language switcher, theme toggle.
- Breadcrumbs component exists (`Breadcrumbs.tsx`) for nested routes (e.g. dispute detail).

## Entry Point

First-time visitor lands on `/` (locale-prefixed, e.g. `/en`) → `LandingPage.tsx`. No evidence of a separate marketing/pre-auth landing vs. app shell split — the same route serves both, gated by wallet-connection state.

## Auth Flow (wallet-based, not email/password)

```
Visitor lands on / (locale root)
  → connects wallet (Freighter) via WalletProvider
  → POST /auth/challenge   (server issues a nonce to sign)
  → user signs challenge with Stellar wallet
  → POST /auth/login       (server verifies signature, issues JWT cookie + CSRF token)
  → role resolved server-side from wallet address vs. ADMIN_WALLETS/AGENT_WALLETS/AUDITOR_WALLETS/LENDER_WALLETS env sets (default: borrower)
  → [optional] POST /auth/kyc   (KYC submission, gated behind requireJwtAuth)
  → dashboard shell renders, scoped by role (RBAC scopes control which routes/data are visible)
```
Session refresh: `POST /auth/refresh` rotates the JWT; `SessionExpiryHandler.tsx` on the frontend handles expiry client-side. Logout: `POST /auth/logout`.

> Note: there is a `POST /auth/register` (`registerTestUser`) but it's explicitly a test-only helper, not a production signup path — production identity is the wallet address itself, no separate registration step.

## Core User Journey 1 — Borrower takes a loan

1. User connects wallet, is authenticated as `borrower` (default role).
2. Goes to `/request-loan` → `LoanApplicationWizard.tsx`: Step 1 amount/asset → Step 2 collateral NFT selection → Step 3 repayment schedule preview → Step 4 final signature (wallet signs the on-chain tx).
3. Backend validates via `loanRoutes.ts` (`POST /loans`), calls `loan_manager` contract.
4. Loan appears in `/loans` and `/loans/[loanId]`; `LoanHealth.tsx` shows collateral ratio.
5. Repayment happens via `/repay/[loanId]`; on-chain repayment triggers a credit-score delta (`SCORE_DELTA_REPAY`) and a Kingdom XP gain (`XPGainAnimation.tsx`, `GlobalXPGain.tsx`).
6. Missed/defaulted loans can be contested (`POST /loans/:loanId/contest-default`) before being marked defaulted, which applies a negative score delta (`SCORE_DELTA_DEFAULT`).

## Core User Journey 2 — Agent cash-in / float transfer

1. Agent registers (`agentRoutes.ts`, backed by `agent_registry` contract) with KYC ref + bond.
2. Once active, agent handles cash-in/cash-out for customers (mint/burn float against posted collateral, enforced by the on-chain solvency invariant).
3. Agent can rebalance liquidity with another agent atomically via `agentFloatRoutes.ts` (`transfer_float`) without moving cash.
4. Indexer picks up on-chain events → dashboard shows live float/collateral ratio.

## Core User Journey 3 — Lender deposits into pool

1. User (role `lender`/`agent` scope) goes to `/lend`.
2. Deposits USDC into `lending_pool` contract (`POST` deposit route in `poolRoutes.ts`).
3. Views yield/share price/analytics (`GET /pool/analytics`, `/pool/stats`).
4. Can withdraw, including emergency withdraw path (tested explicitly — `poolController.emergencyWithdraw.test.ts`).

## Empty / Loading / Error States (confirmed in code, not assumed)

- Dedicated skeleton components per view: `DashboardSkeleton`, `LoansListSkeleton`, `LoanDetailSkeleton`, `WizardSkeleton`, `TransactionsSkeleton`, `CreditScoreSkeleton`, `AchievementsSkeleton`, `KingdomProgressSkeleton`, `DepositWithdrawSkeleton`, `AnalyticsSkeleton`.
- Generic `EmptyState.tsx` component used where a list has no data.
- `RouteErrorView.tsx` + Next.js `error.tsx`/`global-error.tsx` (root and per-route, e.g. `analytics/error.tsx`) handle rendering errors.
- `OfflineBanner.tsx` — shown when the PWA detects no network.
- `PauseBanner.tsx` — shown when the protocol-wide emergency pause / circuit breaker is active (ties to `pauseGuard.ts` middleware and `pause_state` DB table).
- `ErrorBoundary.tsx` (has its own test file) wraps app-level React error boundaries.

## Redirect Logic

- Not fully traceable from route files alone (client-side routing logic lives in page components, not centrally). Known: unauthenticated users hitting a protected route are expected to be redirected to wallet-connect (via `requireJwtAuth` 401s → client interceptor), and admin-only pages (`/admin/*`) are gated by role check before render.
- **Gap**: no single redirect-map doc exists; if you need exact "after X → Y" behavior, trace the specific page's client component rather than assuming a convention.
