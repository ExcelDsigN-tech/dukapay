/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable('audit_epochs', {
    id: { type: 'bigserial', primaryKey: true },
    epoch_start: { type: 'timestamptz', notNull: true, unique: true },
    epoch_end: { type: 'timestamptz', notNull: true },
    merkle_root: { type: 'varchar(64)', notNull: true },
    leaf_count: { type: 'integer', notNull: true },
    anchor_status: { type: 'varchar(20)', notNull: true, default: 'pending' },
    stellar_tx_hash: { type: 'varchar(64)' },
    anchored_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.addConstraint('audit_epochs', 'audit_epochs_status_check', {
    check: "anchor_status IN ('pending', 'anchored', 'failed')",
  });

  pgm.createTable('audit_merkle_leaves', {
    epoch_id: { type: 'bigint', notNull: true, references: 'audit_epochs', onDelete: 'RESTRICT' },
    log_id: {
      type: 'integer',
      notNull: true,
      references: 'audit_logs',
      onDelete: 'RESTRICT',
      unique: true,
    },
    leaf_index: { type: 'integer', notNull: true },
    leaf_hash: { type: 'varchar(64)', notNull: true },
  });
  pgm.addConstraint('audit_merkle_leaves', 'audit_merkle_leaves_epoch_index_unique', {
    unique: ['epoch_id', 'leaf_index'],
  });

  // Normal roles cannot alter history. Retention deletion is possible only
  // after seven years and only inside an explicitly marked cleanup session.
  pgm.sql(`
    CREATE FUNCTION protect_audit_history() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'audit_logs is append-only';
      END IF;
      IF OLD.created_at > NOW() - INTERVAL '7 years'
         OR current_setting('app.audit_retention_cleanup', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'audit log retention policy forbids deletion';
      END IF;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER audit_logs_immutable
      BEFORE UPDATE OR DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION protect_audit_history();
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs');
  pgm.sql('DROP FUNCTION IF EXISTS protect_audit_history()');
  pgm.dropTable('audit_merkle_leaves');
  pgm.dropTable('audit_epochs');
};
