/**
 * Persist the finalized indexer position and a canonical digest for each
 * scanned range. The digest lets the worker detect that a previously indexed
 * range changed and roll it back before continuing.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
export const up = (pgm) => {
  pgm.addColumn('indexer_state', {
    last_finalized_ledger: { type: 'bigint', notNull: true, default: 0 },
  });
  pgm.sql(`
    UPDATE indexer_state
    SET last_finalized_ledger = last_ledger
  `);
  pgm.addColumn('ledger_checkpoints', {
    range_digest: { type: 'varchar(64)' },
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropColumn('ledger_checkpoints', 'range_digest');
  pgm.dropColumn('indexer_state', 'last_finalized_ledger');
};
