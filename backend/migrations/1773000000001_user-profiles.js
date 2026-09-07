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
  pgm.createTable('user_profiles', {
    id: 'id',
    public_key: { type: 'varchar(255)', notNull: true, unique: true },
    display_name: { type: 'varchar(255)' },
    email: { type: 'varchar(255)' },
    phone: { type: 'varchar(50)' },
    email_enabled: { type: 'boolean', notNull: true, default: true },
    sms_enabled: { type: 'boolean', notNull: true, default: true },
    created_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    updated_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
    metadata: { type: 'jsonb' },
  });

  pgm.createIndex('user_profiles', 'public_key');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropTable('user_profiles');
};