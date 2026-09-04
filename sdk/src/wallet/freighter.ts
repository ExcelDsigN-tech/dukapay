import { WalletError } from '../errors.js';
import type { SignedMessage, StellarNetwork, WalletAdapter } from './index.js';

type FreighterApi = typeof import('@stellar/freighter-api');

/**
 * Freighter browser-extension adapter. The `@stellar/freighter-api` package is
 * loaded lazily so the SDK stays usable in non-browser contexts.
 */
export class FreighterAdapter implements WalletAdapter {
  readonly id = 'freighter';
  readonly name = 'Freighter';
  private api: FreighterApi | null = null;

  private async lib(): Promise<FreighterApi> {
    if (this.api) return this.api;
    try {
      this.api = await import('@stellar/freighter-api');
      return this.api;
    } catch (e) {
      throw new WalletError('Failed to load @stellar/freighter-api', e);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { isConnected } = await this.lib();
      const res = await isConnected();
      return typeof res === 'boolean' ? res : Boolean(res?.isConnected);
    } catch {
      return false;
    }
  }

  async connect(): Promise<string> {
    const api = await this.lib();
    const access = await api.requestAccess();
    const address = typeof access === 'string' ? access : access?.address;
    if (!address) throw new WalletError('Freighter access denied');
    return address;
  }

  async disconnect(): Promise<void> {
    /* Freighter has no programmatic disconnect; state is cleared by the caller. */
  }

  async getAddress(): Promise<string | null> {
    try {
      const api = await this.lib();
      const res = await api.getAddress();
      const address = typeof res === 'string' ? res : res?.address;
      return address || null;
    } catch {
      return null;
    }
  }

  async getNetwork(): Promise<StellarNetwork> {
    const api = await this.lib();
    const res = await api.getNetwork();
    const network = typeof res === 'string' ? res : res?.network;
    return /public|mainnet/i.test(network ?? '') ? 'mainnet' : 'testnet';
  }

  async signMessage(message: string): Promise<SignedMessage> {
    const api = await this.lib();
    const signer = (api as unknown as { signMessage?: Function }).signMessage;
    if (!signer) throw new WalletError('This Freighter version does not support signMessage');
    const res = await signer(message);
    const signature =
      typeof res === 'string'
        ? res
        : (res?.signedMessage ?? res?.signature);
    const address = res?.signerAddress ?? (await this.getAddress());
    if (!signature || !address) throw new WalletError('Freighter signMessage returned no signature');
    return {
      signature: signature instanceof Uint8Array ? toBase64(signature) : String(signature),
      address,
    };
  }

  async signTransaction(xdr: string, opts?: { network?: StellarNetwork }): Promise<string> {
    const api = await this.lib();
    const network = opts?.network ?? (await this.getNetwork());
    const res = await api.signTransaction(xdr, {
      networkPassphrase:
        network === 'mainnet'
          ? 'Public Global Stellar Network ; September 2015'
          : 'Test SDF Network ; September 2015',
    });
    const signed = typeof res === 'string' ? res : res?.signedTxXdr;
    if (!signed) throw new WalletError('Freighter did not return a signed transaction');
    return signed;
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const g = globalThis as { btoa?: (s: string) => string };
  if (typeof g.btoa === 'function') return g.btoa(bin);
  // Node without btoa in scope — fall back to a minimal encoder.
  const nodeBuffer = (globalThis as { Buffer?: { from(d: Uint8Array): { toString(enc: string): string } } })
    .Buffer;
  if (nodeBuffer) return nodeBuffer.from(bytes).toString('base64');
  throw new Error('No base64 encoder available in this environment');
}
