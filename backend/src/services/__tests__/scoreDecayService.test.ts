import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type QueryResult = { rows: unknown[]; rowCount: number };
const mockQuery = jest.fn<(sql: string, params?: unknown[]) => Promise<QueryResult>>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
}));

const {
  getInactiveBorrowers,
  applyScoreDecay,
  decayedScore,
  decayFactor,
  lambdaForHalfLife,
  getHalfLifeForEvent,
  DEFAULT_HALF_LIFE_DAYS,
  DEFAULT_PENALTY_HALF_LIFE_DAYS,
} = await import('../scoreDecayService.js');

describe('scoreDecayService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  describe('getInactiveBorrowers', () => {
    it('selects inactive borrowers from the canonical scores table', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ borrower: 'user1', score: 700, last_repayment: null }],
        rowCount: 1,
      });

      const borrowers = await getInactiveBorrowers();

      expect(borrowers).toEqual([{ borrower: 'user1', score: 700, last_repayment: null }]);
      const sql = mockQuery.mock.calls[0]![0];
      expect(sql).toContain('FROM scores s');
      expect(sql).toContain('s.borrower');
      expect(sql).not.toContain('FROM borrowers');
    });
  });

  describe('exponential decay formula', () => {
    it('returns initial score when daysSinceEvent is 0', () => {
      expect(decayedScore(700, 0, 30)).toBe(700);
    });

    it('halves score at half-life', () => {
      expect(decayedScore(700, 30, 30)).toBe(350);
      expect(decayedScore(800, 90, 90)).toBe(400);
    });

    it('quarters score at two half-lives (floored at 300)', () => {
      // 800 * 0.25 = 200 floored to 300
      expect(decayedScore(800, 60, 30)).toBe(300);
      expect(decayedScore(1200, 60, 30)).toBe(300);
    });

    it('uses configurable half-life per event type', () => {
      expect(getHalfLifeForEvent('LoanRepaid')).toBe(DEFAULT_HALF_LIFE_DAYS);
      expect(getHalfLifeForEvent('LoanDefaulted')).toBe(DEFAULT_PENALTY_HALF_LIFE_DAYS);
    });

    it('fixtures: exponential values match formula', () => {
      const score = 700;
      // 15 days at halfLife 30 => factor 0.7071 => ~495
      expect(decayedScore(score, 15, 30)).toBe(Math.max(300, Math.round(score * Math.exp(- (Math.log(2)/30)*15))));
      // 90 days at halfLife 30 => 0.125 => 88 but floored to 300
      expect(decayedScore(score, 90, 30)).toBe(300);
      // 90 days at halfLife 90 => 0.5 => 350
      expect(decayedScore(score, 90, 90)).toBe(350);
    });
  });

  describe('property-based tests for decay curve', () => {
    it('monotonically decreases with increasing days', () => {
      for (const halfLife of [7, 30, 90, 365]) {
        let prev = decayedScore(700, 0, halfLife);
        for (const days of [1, 5, 10, 30, 60, 90, 180, 365]) {
          const cur = decayedScore(700, days, halfLife);
          expect(cur).toBeLessThanOrEqual(prev);
          prev = cur;
        }
      }
    });

    it('never exceeds initial score', () => {
      for (let i = 0; i < 50; i++) {
        const score = 300 + Math.floor(Math.random() * 550);
        const days = Math.random() * 365;
        const halfLife = 10 + Math.random() * 100;
        expect(decayedScore(score, days, halfLife)).toBeLessThanOrEqual(score);
      }
    });

    it('floors at MIN_SCORE', () => {
      for (let i = 0; i < 20; i++) {
        const d = decayedScore(400, 365 * 5, 30);
        expect(d).toBeGreaterThanOrEqual(300);
      }
    });

    it('decayFactor = 0.5 at half-life (invariant)', () => {
      for (const hl of [30, 90, 14, 60]) {
        expect(decayFactor(hl, hl)).toBeCloseTo(0.5, 5);
      }
    });

    it('lambda = ln2 / halfLife', () => {
      expect(lambdaForHalfLife(30)).toBeCloseTo(Math.log(2) / 30, 10);
      expect(lambdaForHalfLife(90)).toBeCloseTo(Math.log(2) / 90, 10);
    });

    it('shorter half-life decays faster than longer half-life', () => {
      for (const days of [10, 30, 60, 100]) {
        const fast = decayedScore(700, days, 30);
        const slow = decayedScore(700, days, 90);
        expect(fast).toBeLessThanOrEqual(slow);
      }
    });

    it('decayFactor * initialScore equals decayedScore (unfloored)', () => {
      for (let i = 0; i < 30; i++) {
        const score = 600 + Math.floor(Math.random() * 200);
        const days = Math.random() * 60;
        const hl = 30;
        const expected = Math.max(300, Math.round(score * decayFactor(days, hl)));
        expect(decayedScore(score, days, hl)).toBe(expected);
      }
    });

    it('old defaults decay slower than new penalties when using 90 vs 30 half-life', () => {
      // After 30 days: default (halfLife 90) retains more than repayment (halfLife 30)
      const repaymentDecay = decayedScore(700, 30, 30); // 350
      const defaultDecay = decayedScore(700, 30, 90); // ~556
      expect(defaultDecay).toBeGreaterThan(repaymentDecay);
    });
  });

  describe('applyScoreDecay', () => {
    it('decays inactive borrower with no repayment using exponential decay (30 days default)', async () => {
      const borrower = { borrower: 'user1', score: 700, last_repayment: null };
      const newScore = await applyScoreDecay(borrower);
      // no history => 30 days => halfLife 30 => 700*0.5=350
      expect(newScore).toBe(350);
      expect(mockQuery).toHaveBeenCalledWith(
        'UPDATE scores SET score = $1, updated_at = CURRENT_TIMESTAMP WHERE borrower = $2',
        [350, 'user1'],
      );
    });

    it('decays borrower inactive for 90 days with faster decay', async () => {
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 90);
      const borrower = {
        borrower: 'user2',
        score: 700,
        last_repayment: ninetyDaysAgo.toISOString(),
      };
      const newScore = await applyScoreDecay(borrower);
      // 90 days hl 30 => floor 300
      expect(newScore).toBe(300);
    });

    it('new defaults penalized less than old defaults with time-weighting', async () => {
      const oneDayAgo = new Date();
      oneDayAgo.setUTCDate(oneDayAgo.getUTCDate() - 1);
      const oldDefault = new Date();
      oldDefault.setUTCDate(oldDefault.getUTCDate() - 60);

      const recent = { borrower: 'recent', score: 700, last_repayment: oneDayAgo.toISOString(), last_event_type: 'LoanDefaulted' };
      const old = { borrower: 'old', score: 700, last_repayment: oldDefault.toISOString(), last_event_type: 'LoanDefaulted' };

      // Use halfLife 90 for defaults: recent should retain more
      const recentScore = await applyScoreDecay(recent);
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
      const oldScore = await applyScoreDecay(old);
      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it('floors score at minimum', async () => {
      const borrower = { borrower: 'user4', score: 304, last_repayment: null };
      const newScore = await applyScoreDecay(borrower);
      expect(newScore).toBe(300);
    });

    it('never drops score below minimum even if already below', async () => {
      const borrower = { borrower: 'user5', score: 200, last_repayment: null };
      const newScore = await applyScoreDecay(borrower);
      expect(newScore).toBe(300);
    });

    it('is idempotent for identical borrower input (within same ms)', async () => {
      const borrower = { borrower: 'user6', score: 700, last_repayment: null };
      const first = await applyScoreDecay(borrower);
      // Reset mock to return same for second call's update
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
      const second = await applyScoreDecay(borrower);
      expect(first).toBe(second);
    });
  });
});
