import type { HttpClient } from './http.js';
import type {
  Challenge,
  DepositorPortfolio,
  Loan,
  LoanConfig,
  Paginated,
  PoolStats,
  Remittance,
  Score,
  Session,
  UnsignedTransaction,
  YieldHistoryPoint,
} from './types.js';

export class AuthResource {
  constructor(private http: HttpClient) {}

  /** Step 1 of wallet login: get a message for the wallet to sign. */
  challenge(publicKey: string): Promise<Challenge> {
    return this.http.post('/auth/challenge', { publicKey }, { anonymous: true });
  }

  /** Step 2: exchange the signed challenge for a session token. */
  login(params: { publicKey: string; message: string; signature: string }): Promise<Session> {
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
    return this.http.get(`/loans/${loanId}`);
  }

  /** Returns an unsigned XDR to be signed by the borrower's wallet. */
  buildRepay(loanId: number | string, amount: string): Promise<UnsignedTransaction> {
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

  analytics(): Promise<unknown> {
    return this.http.get('/pool/analytics', { anonymous: true });
  }

  depositor(address: string): Promise<DepositorPortfolio> {
    return this.http.get(`/pool/depositor/${address}`);
  }

  yieldHistory(address: string, days: 7 | 30 | 90 = 30, token?: string): Promise<YieldHistoryPoint[]> {
    return this.http.get(`/pool/depositor/${address}/yield-history`, { query: { days, token } });
  }

  sharePrice(token: string): Promise<{ sharePrice: string }> {
    return this.http.get(`/pool/${token}/share-price`);
  }

  buildDeposit(params: { token: string; amount: string; from: string }): Promise<UnsignedTransaction> {
    return this.http.post('/pool/build-deposit', params);
  }

  buildWithdraw(params: { token: string; shares: string; from: string }): Promise<UnsignedTransaction> {
    return this.http.post('/pool/build-withdraw', params);
  }
}

export class ScoresResource {
  constructor(private http: HttpClient) {}

  get(address: string): Promise<Score> {
    return this.http.get(`/scores/${address}`);
  }

  leaderboard(limit = 50): Promise<Score[]> {
    return this.http.get('/scores/leaderboard', { query: { limit }, anonymous: true });
  }
}

export class RemittanceResource {
  constructor(private http: HttpClient) {}

  list(params: { sender?: string; recipient?: string } = {}): Promise<Paginated<Remittance>> {
    return this.http.get('/remittance', { query: params });
  }

  get(id: string): Promise<Remittance> {
    return this.http.get(`/remittance/${id}`);
  }

  buildSend(params: { recipient: string; amount: string; from: string }): Promise<UnsignedTransaction> {
    return this.http.post('/remittance/build-send', params);
  }
}
