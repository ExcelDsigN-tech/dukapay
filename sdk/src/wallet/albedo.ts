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
 * Albedo web-wallet adapter. Loads `albedo.link/lib/albedo.intent.js` from a
 * script tag on first use (no npm dependency), matching Albedo's own guidance.
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
      s.src = 'https://albedo.link/albedo.intent.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new WalletError('Failed to load Albedo'));
      document.head.appendChild(s);
    });
    if (!w.albedo) throw new WalletError('Albedo failed to initialise');
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
