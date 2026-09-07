/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.createTable('scores', {
    id: 'id',
    user_id: { type: 'varchar(255)', notNull: true, unique: true },
    current_score: { type: 'integer', notNull: true, default: 500 },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createTable('remittance_history', {
    id: 'id',
    user_id: { type: 'varchar(255)', notNull: true },
    amount: { type: 'numeric', notNull: true },
    month: { type: 'varchar(50)', notNull: true },
    status: { type: 'varchar(50)', notNull: true },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.createIndex('remittance_history', 'user_id');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropTable('remittance_history');
  pgm.dropTable('scores');
};