import { describe, it, expect } from '@jest/globals';
import { markLoanDefaultedSchema, contestDefaultSchema } from '../schemas/loanSchemas.js';

describe('Loan Controller - Zod Validation', () => {
  describe('markLoanDefaultedSchema', () => {
    it('should validate valid Stellar address', () => {
      const input = {
        borrower: 'GBRPK3WI4NMLDW6BWZDTKKOGAXBC6T3PA5ZJZ527ZIMC726NVKBH5J4H',
      };

      expect(() => markLoanDefaultedSchema.parse(input)).not.toThrow();
    });

    it('should reject invalid Stellar address', () => {
      const input = {
        borrower: 'not-a-valid-address',
      };

      expect(() => markLoanDefaultedSchema.parse(input)).toThrow();
    });

    it('should reject empty borrower', () => {
      const input = {
        borrower: '',
      };

      expect(() => markLoanDefaultedSchema.parse(input)).toThrow();
    });

    it('should reject missing borrower', () => {
      const input = {};

      expect(() => markLoanDefaultedSchema.parse(input)).toThrow();
    });
  });

  describe('contestDefaultSchema', () => {
    it('should validate reason with minimum length', () => {
      const input = {
        reason: 'This is a valid reason for contesting',
      };

      expect(() => contestDefaultSchema.parse(input)).not.toThrow();
    });

    it('should reject reason below minimum length', () => {
      const input = {
        reason: 'Bad',
      };

      expect(() => contestDefaultSchema.parse(input)).toThrow();
    });

    it('should reject reason exceeding maximum length', () => {
      const input = {
        reason: 'x'.repeat(501),
      };

      expect(() => contestDefaultSchema.parse(input)).toThrow();
    });

    it('should reject empty reason', () => {
      const input = {
        reason: '',
      };

      expect(() => contestDefaultSchema.parse(input)).toThrow();
    });

    it('should reject missing reason', () => {
      const input = {};

      expect(() => contestDefaultSchema.parse(input)).toThrow();
    });
  });
});

describe('Loan Controller - Config Values', () => {
  it('should have valid default term ledgers', () => {
    const defaultTermLedgers = process.env.DEFAULT_TERM_LEDGERS
      ? Number.parseInt(process.env.DEFAULT_TERM_LEDGERS, 10)
      : 17280;

    expect(defaultTermLedgers).toBeGreaterThan(0);
    expect(Number.isFinite(defaultTermLedgers)).toBe(true);
  });

  it('should have valid default interest rate', () => {
    const defaultInterestRateBps = process.env.DEFAULT_INTEREST_RATE_BPS
      ? Number.parseInt(process.env.DEFAULT_INTEREST_RATE_BPS, 10)
      : 1200;

    expect(defaultInterestRateBps).toBeGreaterThan(0);
    expect(Number.isFinite(defaultInterestRateBps)).toBe(true);
  });

  it('should have valid default fee rate', () => {
    const defaultFeeRateBps = process.env.DEFAULT_FEE_RATE_BPS
      ? Number.parseInt(process.env.DEFAULT_FEE_RATE_BPS, 10)
      : 100;

    expect(defaultFeeRateBps).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(defaultFeeRateBps)).toBe(true);
  });

  it('should have valid ledger close seconds', () => {
    const ledgerCloseSeconds = process.env.LEDGER_CLOSE_SECONDS
      ? Number.parseInt(process.env.LEDGER_CLOSE_SECONDS, 10)
      : 5;

    expect(ledgerCloseSeconds).toBeGreaterThan(0);
    expect(Number.isFinite(ledgerCloseSeconds)).toBe(true);
  });
});
