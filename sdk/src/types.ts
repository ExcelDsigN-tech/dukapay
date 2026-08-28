/**
 * Domain types for the DukaPay API.
 *
 * These are hand-maintained to match `backend/src/swagger` / the Zod schemas.
 * Run `npm run gen:types` (see README) to regenerate from the live OpenAPI spec
 * once the backend publishes one.
 */

export type Address = string;
/** Integer amount in stroops (1 XLM = 10_000_000 stroops), as a decimal string. */
export type Stroops = string;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface Challenge {
  message: string;
  nonce: string;
  expiresAt: string;
}

export interface Session {
  token: string;
  expiresAt: string;
  address: Address;
  scopes: string[];
}

// ── Loans ─────────────────────────────────────────────────────────────────────

export type LoanStatus =
  | 'pending'
  | 'active'
  | 'repaid'
  | 'defaulted'
  | 'liquidated'
  | 'cancelled';

export interface Loan {
  id: number;
  borrower: Address;
  principal: Stroops;
  outstanding: Stroops;
  interestRateBps: number;
  status: LoanStatus;
  originatedAt: string;
  dueAt: string | null;
}

export interface LoanConfig {
  minScore: number;
  maxLoanAmount: Stroops;
  minRepayment: Stroops;
  interestRateBps: number;
  defaultTermLedgers: number;
  gracePeriodLedgers: number;
}

/** Base64 XDR transaction envelope the wallet must sign and submit. */
export interface UnsignedTransaction {
  xdr: string;
  network: 'testnet' | 'mainnet';
}

// ── Pool / float ──────────────────────────────────────────────────────────────

export interface PoolStats {
  token: Address;
  totalDeposits: Stroops;
  totalBorrows: Stroops;
  availableLiquidity: Stroops;
  utilizationBps: number;
  supplyApyBps: number;
  borrowApyBps: number;
  sharePrice: Stroops;
}

export interface DepositorPortfolio {
  address: Address;
  token: Address;
  shares: Stroops;
  depositedValue: Stroops;
  currentValue: Stroops;
  netYield: Stroops;
}

export interface YieldHistoryPoint {
  date: string;
  depositedValue: Stroops;
  currentValue: Stroops;
  netYield: Stroops;
}

// ── Scores ────────────────────────────────────────────────────────────────────

export interface Score {
  address: Address;
  score: number;
  updatedAt: string;
  tier: string;
}

// ── Remittance ────────────────────────────────────────────────────────────────

export interface Remittance {
  id: string;
  tokenId: string;
  sender: Address;
  recipient: Address;
  amount: Stroops;
  status: 'minted' | 'claimed' | 'seized' | 'burned';
  createdAt: string;
}
