import type { HttpClient } from './http.js';
import type {
  Challenge,
  DepositorPortfolio,
  Loan,
  LoanConfig,
  Paginated,
  PoolAnalyticsResponse,
  PoolStats,
  Remittance,
  Score,
  Session,
  UnsignedTransaction,
  YieldHistoryPoint,
} from './types.js';
import { ValidationError } from './errors.js';
import {
  validateStellarAddress,
  validateAmount,
  validatePositiveInt,
} from './validation.js';

export class AuthResource {
  constructor(private http: HttpClient) {}

  /** Step 1 of wallet login: get a message for the wallet to sign. */
  challenge(publicKey: string): Promise<Challenge> {
    validateStellarAddress(publicKey, 'publicKey');
    return this.http.post('/auth/challenge', { publicKey }, { anonymous: true });
  }

  /** Step 2: exchange the signed challenge for a session token. */
  login(params: { publicKey: string; message: string; signature: string }): Promise<Session> {
    validateStellarAddress(params.publicKey, 'publicKey');
    if (!params.message || typeof params.message !== 'string') {
      throw new ValidationError('Invalid message: must be a non-empty string');
    }
    if (!params.signature || typeof params.signature !== 'string') {
      throw new ValidationError('Invalid signature: must be a non-empty string');
    }
    return this.http.post('/auth/login', params, { anonymous: true });
  }

  verify(): Promise<Session> {
    return this.http.get('/auth/verify');
  }

  logout(): Promise<void> {
    return this.http.post('/auth/logout');
  }
}

export class LoansResource {
  constructor(private http: HttpClient) {}

  config(): Promise<LoanConfig> {
    return this.http.get('/loans/config', { anonymous: true });
  }

  list(params: { borrower?: string; status?: string; page?: number; pageSize?: number } = {}): Promise<
    Paginated<Loan>
  > {
    return this.http.get('/loans', { query: params });
  }

  get(loanId: number | string): Promise<Loan> {
    validatePositiveInt(loanId, 'loanId');
    return this.http.get(`/loans/${loanId}`);
  }

  /** Returns an unsigned XDR to be signed by the borrower's wallet. */
  buildRepay(loanId: number | string, amount: string): Promise<UnsignedTransaction> {
    validatePositiveInt(loanId, 'loanId');
    validateAmount(amount, 'amount');
    return this.http.post(`/loans/${loanId}/build-repay`, { amount });
  }

  buildCancel(loanId: number | string): Promise<UnsignedTransaction> {
    return this.http.post(`/loans/${loanId}/build-cancel`);
  }

  /** Submit a wallet-signed XDR for on-chain execution. */
  submit(loanId: number | string, signedXdr: string): Promise<Loan> {
    return this.http.post(`/loans/${loanId}/submit`, { signedXdr });
  }
}

export class PoolResource {
  constructor(private http: HttpClient) {}

  stats(token?: string): Promise<PoolStats> {
    return this.http.get('/pool/stats', { query: { token } });
  }

  /**
   * Aggregate protocol analytics. Public endpoint, cached server-side for 5 minutes.
   *
   * Resolves to the response envelope — read the snapshot from `.analytics`.
   */
  analytics(): Promise<PoolAnalyticsResponse> {
    return this.http.get('/pool/analytics', { anonymous: true });
  }

  depositor(address: string): Promise<DepositorPortfolio> {
    validateStellarAddress(address, 'address');
    return this.http.get(`/pool/depositor/${address}`);
  }

  yieldHistory(address: string, days: 7 | 30 | 90 = 30, token?: string): Promise<YieldHistoryPoint[]> {
    validateStellarAddress(address, 'address');
    return this.http.get(`/pool/depositor/${address}/yield-history`, { query: { days, token } });
  }

  sharePrice(token: string): Promise<{ sharePrice: string }> {
    return this.http.get(`/pool/${token}/share-price`);
  }

  buildDeposit(params: { token: string; amount: string; from: string }): Promise<UnsignedTransaction> {
    validateStellarAddress(params.token, 'token');
    validateAmount(params.amount, 'amount');
    validateStellarAddress(params.from, 'from');
    return this.http.post('/pool/build-deposit', params);
  }

  buildWithdraw(params: { token: string; shares: string; from: string }): Promise<UnsignedTransaction> {
    validateStellarAddress(params.token, 'token');
    validateAmount(params.shares, 'shares');
    validateStellarAddress(params.from, 'from');
    return this.http.post('/pool/build-withdraw', params);
  }
}

export class ScoresResource {
  constructor(private http: HttpClient) {}

  get(address: string): Promise<Score> {
    validateStellarAddress(address, 'address');
    return this.http.get(`/scores/${address}`);
  }

  leaderboard(limit = 50): Promise<Score[]> {
    return this.http.get('/scores/leaderboard', { query: { limit }, anonymous: true });
  }
}

export class RemittanceResource {
  constructor(private http: HttpClient) {}

  list(
    params: { sender?: string; recipient?: string; page?: number; pageSize?: number } = {},
  ): Promise<Paginated<Remittance>> {
    return this.http.get('/remittance', {
      query: { ...params, page: params.page ?? 1, pageSize: params.pageSize ?? 20 },
    });
  }

  get(id: string): Promise<Remittance> {
    return this.http.get(`/remittance/${id}`);
  }

  buildSend(params: { recipient: string; amount: string; from: string }): Promise<UnsignedTransaction> {
    validateStellarAddress(params.recipient, 'recipient');
    validateAmount(params.amount, 'amount');
    validateStellarAddress(params.from, 'from');
    return this.http.post('/remittance/build-send', params);
  }
}
