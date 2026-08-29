import { describe, expect, it } from 'vitest';
import { ContractHelpers } from './contract.js';

describe('ContractHelpers', () => {
  it('round-trips stroops', () => {
    expect(ContractHelpers.toStroops('1.25')).toBe('12500000');
    expect(ContractHelpers.toStroops('0.0000001')).toBe('1');
    expect(ContractHelpers.fromStroops('12500000')).toBe('1.25');
    expect(ContractHelpers.fromStroops('10000000')).toBe('1');
    expect(ContractHelpers.fromStroops('1')).toBe('0.0000001');
  });

  it('converts bps', () => {
    expect(ContractHelpers.bpsToPercent(1250)).toBe(12.5);
    expect(ContractHelpers.percentToBps(12.5)).toBe(1250);
  });

  it('validates addresses', () => {
    expect(ContractHelpers.isStellarAddress('G'.padEnd(56, 'A'))).toBe(true);
    expect(ContractHelpers.isStellarAddress('nope')).toBe(false);
  });

  it('shortens addresses', () => {
    expect(ContractHelpers.shortenAddress('GABCDEFGHIJKLMNOP', 4)).toBe('GABC…MNOP');
  });
});
