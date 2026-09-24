import type { StellarNetwork } from './wallet/index.js';

export const NETWORK_PASSPHRASE: Record<StellarNetwork, string> = {
  mainnet: 'Public Global Stellar Network ; September 2015',
  testnet: 'Test SDF Network ; September 2015',
};

export const DEFAULT_RPC_URL: Record<StellarNetwork, string> = {
  mainnet: 'https://mainnet.sorobanrpc.com',
  testnet: 'https://soroban-testnet.stellar.org',
};

const STROOPS_PER_UNIT = 10_000_000n;

/**
 * Small, dependency-light helpers for working with DukaPay contract values.
 * Anything requiring XDR construction goes through the API's `build*` endpoints;
 * these helpers cover the client-side conversions that would otherwise be
 * reimplemented by every integrator.
 */
export const ContractHelpers = {
  networkPassphrase: (n: StellarNetwork) => NETWORK_PASSPHRASE[n],
  rpcUrl: (n: StellarNetwork) => DEFAULT_RPC_URL[n],

  /** "1.25" -> "12500000" */
  toStroops(amount: string | number): string {
    const [whole = '0', frac = ''] = String(amount).trim().split('.');
    const fracPadded = (frac + '0000000').slice(0, 7);
    const sign = whole.startsWith('-') ? -1n : 1n;
    const wholeAbs = BigInt(whole.replace('-', '') || '0');
    return (sign * (wholeAbs * STROOPS_PER_UNIT + BigInt(fracPadded || '0'))).toString();
  },

  /** "12500000" -> "1.25" (trailing zeros trimmed) */
  fromStroops(stroops: string | bigint): string {
    const v = BigInt(stroops);
    const neg = v < 0n;
    const abs = neg ? -v : v;
    const whole = abs / STROOPS_PER_UNIT;
    const frac = (abs % STROOPS_PER_UNIT).toString().padStart(7, '0').replace(/0+$/, '');
    return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
  },

  /** basis points -> percent number, e.g. 1250 -> 12.5 */
  bpsToPercent: (bps: number) => bps / 100,
  percentToBps: (pct: number) => Math.round(pct * 100),

  /** Format a G... address for display: GABC…WXYZ */
  shortenAddress(address: string, edge = 4): string {
    if (address.length <= edge * 2 + 1) return address;
    return `${address.slice(0, edge)}…${address.slice(-edge)}`;
  },

  isStellarAddress: (v: string) => /^G[A-Z2-7]{55}$/.test(v),
  isContractId: (v: string) => /^C[A-Z2-7]{55}$/.test(v),
};
