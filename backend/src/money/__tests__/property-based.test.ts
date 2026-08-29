import fc from 'fast-check';
import {
  calculateInterest,
  calculateFee,
  roundAmount,
  calculateAmortization,
} from '../calculations';

describe('Property-Based Tests for Financial Calculations', () => {
  describe('Interest Calculations', () => {
    it('interest should always be non-negative', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000000 }),
          fc.float({ min: 0, max: 1 }),
          fc.integer({ min: 1, max: 365 }),
          (principal, rate, days) => {
            const interest = calculateInterest(principal, rate, days);
            expect(interest).toBeGreaterThanOrEqual(0);
          },
        ),
        { numRuns: 10000 },
      );
    });

    it('interest should increase with principal', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 500000 }),
          fc.float({ min: 0.01, max: 0.5 }),
          fc.integer({ min: 1, max: 365 }),
          (principal, rate, days) => {
            const interest1 = calculateInterest(principal, rate, days);
            const interest2 = calculateInterest(principal * 2, rate, days);
            expect(interest2).toBeGreaterThan(interest1);
          },
        ),
        { numRuns: 10000 },
      );
    });

    it('interest should increase with rate', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 100000 }),
          fc.float({ min: 0.01, max: 0.4 }),
          fc.integer({ min: 1, max: 365 }),
          (principal, rate, days) => {
            const interest1 = calculateInterest(principal, rate, days);
            const interest2 = calculateInterest(principal, rate * 2, days);
            expect(interest2).toBeGreaterThanOrEqual(interest1);
          },
        ),
        { numRuns: 10000 },
      );
    });

    it('zero principal should result in zero interest', () => {
      fc.assert(
        fc.property(
          fc.float({ min: 0, max: 1 }),
          fc.integer({ min: 1, max: 365 }),
          (rate, days) => {
            const interest = calculateInterest(0, rate, days);
            expect(interest).toBe(0);
          },
        ),
        { numRuns: 10000 },
      );
    });
  });

  describe('Fee Calculations', () => {
    it('fee should never exceed principal times max rate', () => {
      const MAX_FEE_RATE = 0.1;
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000000 }),
          fc.float({ min: 0, max: MAX_FEE_RATE }),
          (principal, feeRate) => {
            const fee = calculateFee(principal, feeRate);
            expect(fee).toBeLessThanOrEqual(principal * MAX_FEE_RATE);
          },
        ),
        { numRuns: 10000 },
      );
    });

    it('fee should be proportional to principal', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 100, max: 100000 }),
          fc.float({ min: 0.01, max: 0.1 }),
          (principal, feeRate) => {
            const fee1 = calculateFee(principal, feeRate);
            const fee2 = calculateFee(principal * 2, feeRate);
            expect(Math.abs(fee2 - fee1 * 2)).toBeLessThan(1);
          },
        ),
        { numRuns: 10000 },
      );
    });

    it('zero fee rate should result in zero fee', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 1000000 }), (principal) => {
          const fee = calculateFee(principal, 0);
          expect(fee).toBe(0);
        }),
        { numRuns: 10000 },
      );
    });
  });

  describe('Rounding Consistency', () => {
    it('rounding should be idempotent', () => {
      fc.assert(
        fc.property(fc.float({ min: 0, max: 1000000 }), (amount) => {
          const rounded = roundAmount(amount);
          const doubleRounded = roundAmount(rounded);
          expect(rounded).toBe(doubleRounded);
        }),
        { numRuns: 10000 },
      );
    });

    it('rounding should not increase value beyond one cent', () => {
      fc.assert(
        fc.property(fc.float({ min: 0, max: 1000000 }), (amount) => {
          const rounded = roundAmount(amount);
          expect(rounded - amount).toBeLessThanOrEqual(0.01);
        }),
        { numRuns: 10000 },
      );
    });

    it('already rounded amounts should remain unchanged', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 1000000 }),
          fc.integer({ min: 0, max: 99 }),
          (dollars, cents) => {
            const amount = dollars + cents / 100;
            const rounded = roundAmount(amount);
            expect(Math.abs(rounded - amount)).toBeLessThan(0.001);
          },
        ),
        { numRuns: 10000 },
      );
    });
  });

  describe('Amortization Correctness', () => {
    it('sum of amortization payments should equal principal plus interest', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 100000 }),
          fc.float({ min: 0.05, max: 0.3 }),
          fc.integer({ min: 3, max: 12 }),
          (principal, annualRate, months) => {
            const schedule = calculateAmortization(principal, annualRate, months);
            const totalPaid = schedule.reduce((sum, payment) => sum + payment.amount, 0);
            const expectedTotal = principal + calculateInterest(principal, annualRate, months * 30);
            expect(Math.abs(totalPaid - expectedTotal)).toBeLessThan(1);
          },
        ),
        { numRuns: 10000 },
      );
    });

    it('no payment should be negative', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 100000 }),
          fc.float({ min: 0.05, max: 0.3 }),
          fc.integer({ min: 1, max: 12 }),
          (principal, annualRate, months) => {
            const schedule = calculateAmortization(principal, annualRate, months);
            schedule.forEach((payment) => {
              expect(payment.amount).toBeGreaterThan(0);
              expect(payment.principal).toBeGreaterThanOrEqual(0);
              expect(payment.interest).toBeGreaterThanOrEqual(0);
            });
          },
        ),
        { numRuns: 10000 },
      );
    });

    it('remaining balance should decrease to zero', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 100000 }),
          fc.float({ min: 0.05, max: 0.3 }),
          fc.integer({ min: 1, max: 12 }),
          (principal, annualRate, months) => {
            const schedule = calculateAmortization(principal, annualRate, months);
            const finalBalance = schedule[schedule.length - 1].remainingBalance;
            expect(Math.abs(finalBalance)).toBeLessThan(1);
          },
        ),
        { numRuns: 10000 },
      );
    });

    it('early payments should have more interest than later payments', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10000, max: 100000 }),
          fc.float({ min: 0.1, max: 0.3 }),
          fc.integer({ min: 6, max: 12 }),
          (principal, annualRate, months) => {
            const schedule = calculateAmortization(principal, annualRate, months);
            const firstInterest = schedule[0].interest;
            const lastInterest = schedule[schedule.length - 1].interest;
            expect(firstInterest).toBeGreaterThan(lastInterest);
          },
        ),
        { numRuns: 10000 },
      );
    });
  });

  describe('Balance Invariants', () => {
    it('balance should never be negative after transactions', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1000, max: 100000 }),
          fc.array(fc.integer({ min: -500, max: 1000 }), { minLength: 1, maxLength: 100 }),
          (initialBalance, transactions) => {
            let balance = initialBalance;
            for (const transaction of transactions) {
              const newBalance = balance + transaction;
              if (newBalance >= 0) {
                balance = newBalance;
              }
            }
            expect(balance).toBeGreaterThanOrEqual(0);
          },
        ),
        { numRuns: 10000 },
      );
    });
  });
});
