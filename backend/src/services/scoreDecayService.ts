// Service for score decay logic — exponential time-weighted decay
// Implements: score * e^(-lambda * days_since_event) where lambda = ln(2)/halfLife
import { query } from '../db/connection.js';

export const MIN_SCORE = 300;
export const MAX_SCORE = 850;

// Configurable half-life per event type (days)
// Default: 30 days for repayment-type events, 90 days for default-type events
export const DEFAULT_HALF_LIFE_DAYS = 30;
export const DEFAULT_PENALTY_HALF_LIFE_DAYS = 90;

export const HALF_LIFE_BY_EVENT: Record<string, number> = {
  LoanRepaid: Number.parseInt(process.env.SCORE_DECAY_HALF_LIFE_REPAID ?? '', 10) || DEFAULT_HALF_LIFE_DAYS,
  LoanApproved: Number.parseInt(process.env.SCORE_DECAY_HALF_LIFE_APPROVED ?? '', 10) || DEFAULT_HALF_LIFE_DAYS,
  LoanDefaulted:
    Number.parseInt(process.env.SCORE_DECAY_HALF_LIFE_DEFAULTED ?? '', 10) ||
    DEFAULT_PENALTY_HALF_LIFE_DAYS,
  default: DEFAULT_HALF_LIFE_DAYS,
};

export function getHalfLifeForEvent(eventType: string): number {
  return HALF_LIFE_BY_EVENT[eventType] ?? HALF_LIFE_BY_EVENT['default']!;
}

export function lambdaForHalfLife(halfLifeDays: number): number {
  if (halfLifeDays <= 0) throw new Error('halfLife must be > 0');
  return Math.log(2) / halfLifeDays;
}

/**
 * Exponential decay: score * e^(-lambda * days)
 * lambda = ln(2) / halfLifeDays
 */
export function decayedScore(
  initialScore: number,
  daysSinceEvent: number,
  halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
): number {
  if (daysSinceEvent <= 0) return Math.round(initialScore);
  const lambda = lambdaForHalfLife(halfLifeDays);
  const decayed = initialScore * Math.exp(-lambda * daysSinceEvent);
  return Math.max(MIN_SCORE, Math.round(decayed));
}

/**
 * Compute decay factor for property tests: e^(-lambda * days)
 */
export function decayFactor(daysSinceEvent: number, halfLifeDays: number): number {
  if (daysSinceEvent <= 0) return 1;
  return Math.exp(-lambdaForHalfLife(halfLifeDays) * daysSinceEvent);
}

export interface InactiveBorrower {
  borrower: string;
  score: number;
  last_repayment: string | null;
  last_event_type?: string | null;
}

// Decay events table row
export interface DecayEvent {
  id?: number;
  borrower: string;
  event_type: string;
  event_timestamp: string;
  initial_score: number;
  half_life_days: number;
  created_at?: string;
}

// Get borrowers who have not repaid in the last month
export async function getInactiveBorrowers(): Promise<InactiveBorrower[]> {
  const result = await query(`
    SELECT s.borrower, s.score, MAX(e.ledger_closed_at) AS last_repayment,
           (ARRAY_AGG(e.event_type ORDER BY e.ledger_closed_at DESC))[1] AS last_event_type
    FROM scores s
    LEFT JOIN contract_events e ON s.borrower = e.address AND e.event_type IN ('LoanRepaid','LoanApproved','LoanDefaulted')
    GROUP BY s.borrower, s.score
    HAVING MAX(e.ledger_closed_at) IS NULL OR MAX(e.ledger_closed_at) < NOW() - INTERVAL '1 month'
  `);
  return result.rows as InactiveBorrower[];
}

// Record a decay event with timestamp
export async function recordDecayEvent(event: DecayEvent): Promise<void> {
  await query(
    `INSERT INTO decay_events (borrower, event_type, event_timestamp, initial_score, half_life_days)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [event.borrower, event.event_type, event.event_timestamp, event.initial_score, event.half_life_days],
  );
}

// Backfill historical events with correct timestamps from contract_events
export async function backfillDecayEvents(): Promise<number> {
  const result = await query(`
    INSERT INTO decay_events (borrower, event_type, event_timestamp, initial_score, half_life_days)
    SELECT
      ce.address AS borrower,
      ce.event_type,
      ce.ledger_closed_at AS event_timestamp,
      COALESCE(s.score, 600) AS initial_score,
      CASE ce.event_type
        WHEN 'LoanDefaulted' THEN ${DEFAULT_PENALTY_HALF_LIFE_DAYS}
        ELSE ${DEFAULT_HALF_LIFE_DAYS}
      END AS half_life_days
    FROM contract_events ce
    LEFT JOIN scores s ON s.borrower = ce.address
    WHERE ce.event_type IN ('LoanRepaid','LoanApproved','LoanDefaulted')
      AND ce.ledger_closed_at IS NOT NULL
      AND ce.address IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM decay_events de
        WHERE de.borrower = ce.address
          AND de.event_type = ce.event_type
          AND de.event_timestamp = ce.ledger_closed_at
      )
    ON CONFLICT DO NOTHING
  `);
  return result.rowCount ?? 0;
}

// Apply exponential score decay to a borrower based on time since last event
export async function applyScoreDecay(borrower: InactiveBorrower) {
  const lastRepayment = borrower.last_repayment;
  const eventType = borrower.last_event_type ?? 'default';
  const halfLife = getHalfLifeForEvent(eventType);
  const now = new Date();

  let daysSince = 30; // default 1 month if no history
  if (lastRepayment) {
    const last = new Date(lastRepayment);
    const diffMs = now.getTime() - last.getTime();
    daysSince = Math.max(0, diffMs / (24 * 60 * 60 * 1000));
  }

  const newScore = decayedScore(borrower.score, daysSince, halfLife);

  await query(`UPDATE scores SET score = $1, updated_at = CURRENT_TIMESTAMP WHERE borrower = $2`, [
    newScore,
    borrower.borrower,
  ]);

  // Record decay event for audit trail
  try {
    await recordDecayEvent({
      borrower: borrower.borrower,
      event_type: `decay:${eventType}`,
      event_timestamp: now.toISOString(),
      initial_score: borrower.score,
      half_life_days: halfLife,
    });
  } catch {
    // non-critical: don't fail decay if event logging fails
  }

  return newScore;
}
