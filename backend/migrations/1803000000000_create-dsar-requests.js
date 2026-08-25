/**
 * Create DSAR (Data Subject Access Request) table for GDPR/CCPA compliance.
 *
 * Tracks data access, deletion, and anonymization requests from users.
 * Required for demonstrating compliance with data privacy regulations.
 */
exports.up = async function up(pgm) {
  await pgm.createTable('dsar_requests', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    public_key: {
      type: 'text',
      notNull: true,
    },
    type: {
      type: 'text',
      notNull: true,
      check: "type IN ('access', 'deletion', 'anonymization')",
    },
    status: {
      type: 'text',
      notNull: true,
      default: "'pending'",
      check: "status IN ('pending', 'processing', 'completed', 'rejected')",
    },
    reason: {
      type: 'text',
      notNull: true,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('NOW()'),
    },
    completed_at: {
      type: 'timestamptz',
      notNull: false,
    },
  });

  await pgm.addIndex('dsar_requests', ['public_key']);
  await pgm.addIndex('dsar_requests', ['status']);
  await pgm.addIndex('dsar_requests', ['created_at']);
};

exports.down = async function down(pgm) {
  await pgm.dropTable('dsar_requests');
};
