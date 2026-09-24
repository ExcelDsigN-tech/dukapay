/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * Issue #444: add indexes for the slow-query report — loan listing
 * (borrower + created_at), agent dashboard (agent_vaults), and score
 * reconciliation (borrower + date). Indexes are created only when the
 * underlying table/columns exist, so this migration is safe in every
 * deployment shape.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF to_regclass('public.scores') IS NOT NULL THEN
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_scores_borrower_date ON scores (borrower, updated_at)');
      END IF;
      IF to_regclass('public.contract_events') IS NOT NULL THEN
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_contract_events_address_created ON contract_events (address, created_at)');
      END IF;
      IF to_regclass('public.agent_vaults') IS NOT NULL THEN
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_agent_vaults_agent ON agent_vaults (agent_address)');
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_agent_vaults_active ON agent_vaults (is_active) WHERE is_active = true');
      END IF;
      IF to_regclass('public.user_notification_preferences') IS NOT NULL THEN
        EXECUTE format('CREATE INDEX IF NOT EXISTS idx_notif_prefs_user ON user_notification_preferences (user_id)');
      END IF;
    END $$;
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {void}
 */
exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_scores_borrower_date;
    DROP INDEX IF EXISTS idx_contract_events_address_created;
    DROP INDEX IF EXISTS idx_agent_vaults_agent;
    DROP INDEX IF EXISTS idx_agent_vaults_active;
    DROP INDEX IF EXISTS idx_notif_prefs_user;
  `);
};