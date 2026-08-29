/**
 * Saga pattern settlement state machine (issue #420).
 * Adds settlement_state tracking and compensation support.
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  // Extend state check to include new saga states (if not already inclusive)
  // Drop old constraint and add new one that includes PENDING/PARTIAL/COMPLETED/FAILED
  try {
    pgm.dropConstraint('cross_contract_reconciliation', 'cross_contract_reconciliation_state_check');
  } catch {}

  // Add settlement-specific columns
  pgm.addColumn('cross_contract_reconciliation', {
    settlement_state: {
      type: 'varchar(16)',
      default: 'PENDING',
    },
    compensation_attempts: { type: 'integer', notNull: true, default: 0 },
    partial_since: { type: 'timestamp' },
  });

  // Backfill settlement_state from legacy state
  pgm.sql(`
    UPDATE cross_contract_reconciliation
    SET settlement_state = CASE state
      WHEN 'pending' THEN 'PENDING'
      WHEN 'half_applied' THEN 'PARTIAL'
      WHEN 'reconciled' THEN 'COMPLETED'
      WHEN 'failed' THEN 'FAILED'
      ELSE 'PENDING'
    END
    WHERE settlement_state IS NULL OR settlement_state = 'PENDING'
  `);

  // Update partial_since for existing PARTIAL rows
  pgm.sql(`
    UPDATE cross_contract_reconciliation
    SET partial_since = updated_at
    WHERE settlement_state = 'PARTIAL' AND partial_since IS NULL
  `);

  pgm.createIndex('cross_contract_reconciliation', 'settlement_state');

  // Add check constraint for settlement_state
  pgm.addConstraint('cross_contract_reconciliation', 'settlement_state_check', {
    check: "settlement_state IN ('PENDING', 'PARTIAL', 'COMPLETED', 'FAILED')",
  });

  // Extend legacy state check to be permissive (keep both)
  pgm.addConstraint('cross_contract_reconciliation', 'cross_contract_reconciliation_state_check2', {
    check: "state IN ('pending', 'half_applied', 'reconciled', 'failed', 'PENDING', 'PARTIAL', 'COMPLETED', 'FAILED')",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const down = (pgm) => {
  try {
    pgm.dropConstraint('cross_contract_reconciliation', 'settlement_state_check');
  } catch {}
  try {
    pgm.dropConstraint('cross_contract_reconciliation', 'cross_contract_reconciliation_state_check2');
  } catch {}
  pgm.dropColumn('cross_contract_reconciliation', 'settlement_state');
  pgm.dropColumn('cross_contract_reconciliation', 'compensation_attempts');
  pgm.dropColumn('cross_contract_reconciliation', 'partial_since');
};
