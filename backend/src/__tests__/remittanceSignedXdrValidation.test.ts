/**
 * #670 — `validateSignedXdr` rejects envelopes that do not pay the
 * remittance's recipient the exact amount and asset from the sender.
 */
import { jest } from '@jest/globals';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: jest.fn() },
  pool: { query: jest.fn(), connect: jest.fn(), end: jest.fn() },
  query: jest.fn(),
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../config/stellar.js', () => ({
  getStellarNetworkPassphrase: () => Networks.TESTNET,
  createSorobanRpcServer: jest.fn(),
}));

const { remittanceService } = await import('../services/remittanceService.js');

const sender = Keypair.random();
const recipient = Keypair.random().publicKey();

const remittance = {
  id: 'remittance-1',
  senderId: sender.publicKey(),
  recipientAddress: recipient,
  amount: 100,
  fromCurrency: 'XLM',
  toCurrency: 'XLM',
  status: 'pending' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function signedPayment(opts: { destination?: string; amount?: string; asset?: Asset } = {}) {
  const tx = new TransactionBuilder(new Account(sender.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: opts.destination ?? recipient,
        asset: opts.asset ?? Asset.native(),
        amount: opts.amount ?? '100',
      }),
    )
    .setTimeout(30)
    .build();
  tx.sign(sender);
  return tx.toXDR();
}

describe('remittanceService.validateSignedXdr (#670)', () => {
  it('accepts the matching payment', () => {
    expect(() => remittanceService.validateSignedXdr(remittance, signedPayment())).not.toThrow();
  });

  it('rejects a different destination', () => {
    const xdr = signedPayment({ destination: Keypair.random().publicKey() });
    expect(() => remittanceService.validateSignedXdr(remittance, xdr)).toThrow(/destination/);
  });

  it('rejects a different amount', () => {
    const xdr = signedPayment({ amount: '1000' });
    expect(() => remittanceService.validateSignedXdr(remittance, xdr)).toThrow(/amount/);
  });

  it('rejects a different asset', () => {
    const xdr = signedPayment({ asset: new Asset('USDC', Keypair.random().publicKey()) });
    expect(() => remittanceService.validateSignedXdr(remittance, xdr)).toThrow(/asset/);
  });

  it('rejects a different source account', () => {
    const other = { ...remittance, senderId: Keypair.random().publicKey() };
    expect(() => remittanceService.validateSignedXdr(other, signedPayment())).toThrow(/source/);
  });

  it('rejects garbage input', () => {
    expect(() => remittanceService.validateSignedXdr(remittance, 'not-xdr')).toThrow(
      /valid transaction envelope/,
    );
  });
});
