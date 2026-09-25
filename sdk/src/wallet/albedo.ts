import { WalletError } from '../errors.js';
import type { SignedMessage, StellarNetwork, WalletAdapter } from './index.js';

interface AlbedoIntent {
  publicKey(params: { token?: string }): Promise<{ pubkey: string }>;
  signMessage(params: { message: string; pubkey?: string }): Promise<{
    signature: string;
    signed_message: string;
    pubkey: string;
  }>;
  tx(params: { xdr: string; network?: string; pubkey?: string }): Promise<{
    signed_envelope_xdr: string;
  }>;
}

/**
 * Pinned build of `@albedo-link/intent`. The integrity hash must be updated
 * together with the version: `curl -s <url> | openssl dgst -sha384 -binary | base64`.
 */
export const ALBEDO_SCRIPT_URL =
  'https://cdn.jsdelivr.net/npm/@albedo-link/intent@0.13.0/lib/albedo.intent.js';
export const ALBEDO_SCRIPT_INTEGRITY =
  'sha384-MoOxg+oiO2zk7uG3/ExUMvrSZvpbT7xb3Z1sJ4Ofs2SHsqtx6hyGUd5dOu9jGQMO';
export const ALBEDO_SCRIPT_TIMEOUT_MS = 15_000;

const LOAD_FAILED_MESSAGE =
  'Could not load the Albedo wallet. Check your connection or try another wallet.';

/**
 * Albedo web-wallet adapter. Loads a pinned copy of Albedo's intent script
 * from a script tag on first use (no npm dependency), checked with Subresource
 * Integrity so a tampered file is refused by the browser.
 */
export class AlbedoAdapter implements WalletAdapter {
  readonly id = 'albedo';
  readonly name = 'Albedo';
  private cachedAddress: string | null = null;
  private network: StellarNetwork;

  constructor(opts: { network?: StellarNetwork } = {}) {
    this.network = opts.network ?? 'testnet';
  }

  private async intent(): Promise<AlbedoIntent> {
    const w = globalThis as unknown as { albedo?: AlbedoIntent };
    if (w.albedo) return w.albedo;
    if (typeof document === 'undefined') {
      throw new WalletError('Albedo is only available in a browser');
    }
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      const fail = () => {
        clearTimeout(timer);
        s.remove();
        reject(new WalletError(LOAD_FAILED_MESSAGE));
      };
      const timer = setTimeout(fail, ALBEDO_SCRIPT_TIMEOUT_MS);
      s.src = ALBEDO_SCRIPT_URL;
      s.integrity = ALBEDO_SCRIPT_INTEGRITY;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      s.onerror = fail;
      document.head.appendChild(s);
    });
    if (!w.albedo) throw new WalletError(LOAD_FAILED_MESSAGE);
    return w.albedo;
  }

  async isAvailable(): Promise<boolean> {
    return typeof document !== 'undefined';
  }

  async connect(): Promise<string> {
    const albedo = await this.intent();
    const { pubkey } = await albedo.publicKey({});
    this.cachedAddress = pubkey;
    return pubkey;
  }

  async disconnect(): Promise<void> {
    this.cachedAddress = null;
  }

  async getAddress(): Promise<string | null> {
    return this.cachedAddress;
  }

  async getNetwork(): Promise<StellarNetwork> {
    return this.network;
  }

  async signMessage(message: string): Promise<SignedMessage> {
    const albedo = await this.intent();
    const res = await albedo.signMessage({
      message,
      pubkey: this.cachedAddress ?? undefined,
    });
    this.cachedAddress = res.pubkey;
    return { signature: res.signature, address: res.pubkey };
  }

  async signTransaction(xdr: string, opts?: { network?: StellarNetwork }): Promise<string> {
    const albedo = await this.intent();
    const res = await albedo.tx({
      xdr,
      network: (opts?.network ?? this.network) === 'mainnet' ? 'public' : 'testnet',
      pubkey: this.cachedAddress ?? undefined,
    });
    return res.signed_envelope_xdr;
  }
}
