import { WalletError } from '../errors.js';

export type StellarNetwork = 'testnet' | 'mainnet';

export interface SignedMessage {
  /** Base64 signature over the challenge message. */
  signature: string;
  /** Signer public key (G...). */
  address: string;
}

/**
 * Uniform wallet interface consumed by `DukaPayClient` and the React hooks.
 * Implementations: {@link FreighterAdapter}, {@link AlbedoAdapter}. Bring your
 * own by implementing this interface (e.g. Ledger, WalletConnect).
 */
export interface WalletAdapter {
  readonly id: string;
  readonly name: string;
  /** Whether the wallet is installed / reachable in the current environment. */
  isAvailable(): Promise<boolean>;
  /** Prompt the user to connect; resolves with the selected public key. */
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  /** Currently authorized public key, or null. */
  getAddress(): Promise<string | null>;
  getNetwork(): Promise<StellarNetwork>;
  /** Sign an arbitrary UTF-8 message (used for the auth challenge). */
  signMessage(message: string): Promise<SignedMessage>;
  /** Sign a base64 transaction XDR; returns the signed XDR. */
  signTransaction(xdr: string, opts?: { network?: StellarNetwork }): Promise<string>;
}

export function assertWallet(w: WalletAdapter | null | undefined): asserts w is WalletAdapter {
  if (!w) throw new WalletError('No wallet connected');
}

export { FreighterAdapter } from './freighter.js';
export { AlbedoAdapter } from './albedo.js';
