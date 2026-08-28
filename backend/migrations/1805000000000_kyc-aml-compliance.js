/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  pgm.createTable('compliance_profiles', {
    subject_id: { type: 'varchar(56)', primaryKey: true },
    provider: { type: 'varchar(40)', notNull: true },
    provider_reference: { type: 'varchar(255)' },
    status: { type: 'varchar(20)', notNull: true },
    country_code: { type: 'char(2)' },
    sanctions_match: { type: 'boolean', notNull: true, default: false },
    pep_match: { type: 'boolean', notNull: true, default: false },
    adverse_media_match: { type: 'boolean', notNull: true, default: false },
    screened_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    next_screening_at: { type: 'timestamptz', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.addConstraint('compliance_profiles', 'compliance_profiles_status_check', {
    check: "status IN ('approved', 'review', 'rejected')",
  });

  pgm.createTable('compliance_audit_log', {
    id: { type: 'bigserial', primaryKey: true },
    subject_id: { type: 'varchar(56)' },
    event_type: { type: 'varchar(60)', notNull: true },
    decision: { type: 'varchar(30)', notNull: true },
    provider_reference: { type: 'varchar(255)' },
    reason_codes: { type: 'jsonb', notNull: true, default: '[]' },
    metadata: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('compliance_audit_log', ['subject_id', 'created_at']);
  pgm.sql(`
    CREATE FUNCTION prevent_compliance_audit_mutation() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'compliance_audit_log is append-only';
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER compliance_audit_log_immutable
      BEFORE UPDATE OR DELETE ON compliance_audit_log
      FOR EACH ROW EXECUTE FUNCTION prevent_compliance_audit_mutation();
  `);

  pgm.createTable('transaction_monitoring_alerts', {
    id: { type: 'uuid', primaryKey: true },
    subject_id: { type: 'varchar(56)', notNull: true },
    transaction_reference: { type: 'uuid' },
    risk_score: { type: 'integer', notNull: true },
    rule_codes: { type: 'jsonb', notNull: true },
    status: { type: 'varchar(20)', notNull: true, default: 'open' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
  pgm.createIndex('transaction_monitoring_alerts', ['subject_id', 'created_at']);

  pgm.createTable('sar_reports', {
    id: { type: 'uuid', primaryKey: true },
    alert_id: { type: 'uuid', notNull: true, references: 'transaction_monitoring_alerts' },
    subject_id: { type: 'varchar(56)', notNull: true },
    narrative: { type: 'text', notNull: true },
    filing_status: { type: 'varchar(30)', notNull: true, default: 'pending_submission' },
    provider_reference: { type: 'varchar(255)' },
    generated_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    filed_at: { type: 'timestamptz' },
  });
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  pgm.dropTable('sar_reports');
  pgm.dropTable('transaction_monitoring_alerts');
  pgm.dropTable('compliance_audit_log');
  pgm.sql('DROP FUNCTION IF EXISTS prevent_compliance_audit_mutation()');
  pgm.dropTable('compliance_profiles');
};
