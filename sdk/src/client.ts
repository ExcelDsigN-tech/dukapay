import { HttpClient, type HttpClientOptions } from './http.js';
import {
  AuthResource,
  LoansResource,
  PoolResource,
  RemittanceResource,
  ScoresResource,
} from './resources.js';
import type { Session } from './types.js';
import { assertWallet, type StellarNetwork, type WalletAdapter } from './wallet/index.js';

export interface DukaPayClientOptions {
  /** API base URL, e.g. https://api.dukapay.io */
  baseUrl: string;
  /** Stellar network the API is bound to. Defaults to 'testnet'. */
  network?: StellarNetwork;
  /** Optional wallet adapter for `loginWithWallet` / `signAndSubmit`. */
  wallet?: WalletAdapter;
  /** Pre-existing session token. */
  token?: string;
  /** Advanced HTTP tuning. */
  http?: Partial<Omit<HttpClientOptions, 'baseUrl' | 'token'>>;
  /** Called whenever the session changes (login, logout, refresh). */
  onSession?: (session: Session | null) => void;
}

/**
 * The main entry point. Typed access to every DukaPay API resource plus a
 * one-call wallet login flow.
 *
 * ```ts
 * const client = new DukaPayClient({ baseUrl, wallet: new FreighterAdapter() });
 * await client.loginWithWallet();
 * const loans = await client.loans.list({ borrower: await client.address() });
 * ```
 */
export class DukaPayClient {
  readonly http: HttpClient;
  readonly network: StellarNetwork;
  readonly auth: AuthResource;
  readonly loans: LoansResource;
  readonly pool: PoolResource;
  readonly scores: ScoresResource;
  readonly remittance: RemittanceResource;

  private session: Session | null = null;
  private wallet?: WalletAdapter;
  private readonly onSession?: (s: Session | null) => void;

  constructor(opts: DukaPayClientOptions) {
    this.network = opts.network ?? 'testnet';
    this.wallet = opts.wallet;
    this.onSession = opts.onSession;
    this.http = new HttpClient({
      baseUrl: opts.baseUrl,
      token: () => this.session?.token,
      ...opts.http,
    });
    if (opts.token) this.session = { token: opts.token } as Session;

    this.auth = new AuthResource(this.http);
    this.loans = new LoansResource(this.http);
    this.pool = new PoolResource(this.http);
    this.scores = new ScoresResource(this.http);
    this.remittance = new RemittanceResource(this.http);
  }

  // ── Session ────────────────────────────────────────────────────────────────

  getSession(): Session | null {
    return this.session;
  }

  setSession(session: Session | null): void {
    this.session = session;
    this.onSession?.(session);
  }

  setWallet(wallet: WalletAdapter | undefined): void {
    this.wallet = wallet;
  }

  /** Connect the wallet without authenticating against the API. */
  async connectWallet(): Promise<string> {
    assertWallet(this.wallet);
    return this.wallet.connect();
  }

  isAuthenticated(): boolean {
    return Boolean(this.session?.token);
  }

  async address(): Promise<string | null> {
    if (this.session?.address) return this.session.address;
    return this.wallet ? this.wallet.getAddress() : null;
  }

  /** Full wallet login: connect → challenge → sign → login. Idempotent-ish. */
  async loginWithWallet(): Promise<Session> {
    assertWallet(this.wallet);
    const address = (await this.wallet.getAddress()) ?? (await this.wallet.connect());
    const { message } = await this.auth.challenge(address);
    const { signature } = await this.wallet.signMessage(message);
    const session = await this.auth.login({ publicKey: address, message, signature });
    this.setSession(session);
    return session;
  }

  async logout(): Promise<void> {
    try {
      if (this.session?.token) await this.auth.logout();
    } finally {
      this.setSession(null);
      await this.wallet?.disconnect().catch(() => {});
    }
  }

  // ── Transactions ───────────────────────────────────────────────────────────

  /**
   * Sign an unsigned XDR with the connected wallet and hand the signed XDR to a
   * submitter (typically one of the resource `submit*` calls).
   */
  async signAndSubmit<T>(
    unsigned: { xdr: string },
    submit: (signedXdr: string) => Promise<T>,
  ): Promise<T> {
    assertWallet(this.wallet);
    const signedXdr = await this.wallet.signTransaction(unsigned.xdr, { network: this.network });
    return submit(signedXdr);
  }
}
