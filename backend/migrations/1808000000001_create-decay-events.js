/**
 * Decay events table for time-weighted exponential score decay (issue #419).
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.createTable('decay_events', {
    id: 'id',
    borrower: { type: 'varchar(255)', notNull: true },
    event_type: { type: 'varchar(64)', notNull: true },
    event_timestamp: { type: 'timestamp', notNull: true },
    initial_score: { type: 'integer', notNull: true },
    half_life_days: { type: 'integer', notNull: true, default: 30 },
    decay_factor: { type: 'numeric' },
    decayed_score: { type: 'integer' },
    created_at: { type: 'timestamp', notNull: true, default: pgm.func('current_timestamp') },
  });

  pgm.createIndex('decay_events', ['borrower', 'event_timestamp']);
  pgm.createIndex('decay_events', 'event_type');

  // Unique constraint to prevent duplicate backfill inserts
  pgm.addConstraint('decay_events', 'decay_events_unique', {
    unique: ['borrower', 'event_type', 'event_timestamp'],
  });

  // Backfill historical events with correct timestamps from contract_events
  pgm.sql(`
    INSERT INTO decay_events (borrower, event_type, event_timestamp, initial_score, half_life_days)
    SELECT
      ce.address AS borrower,
      ce.event_type,
      ce.ledger_closed_at AS event_timestamp,
      COALESCE(s.score, 600) AS initial_score,
      CASE ce.event_type
        WHEN 'LoanDefaulted' THEN 90
        ELSE 30
      END AS half_life_days
    FROM contract_events ce
    LEFT JOIN scores s ON s.borrower = ce.address
    WHERE ce.event_type IN ('LoanRepaid','LoanApproved','LoanDefaulted')
      AND ce.ledger_closed_at IS NOT NULL
      AND ce.address IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  pgm.dropTable('decay_events');
};
