/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.up = (pgm) => {
  pgm.addColumns('user_notification_preferences', {
    digest_frequency: {
      type: 'varchar(20)',
      notNull: true,
      default: 'off',
      check: "digest_frequency IN ('off', 'daily', 'weekly')",
      comment: 'Digest mode for repayment reminders: off, daily, or weekly',
    },
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
exports.down = (pgm) => {
  pgm.dropColumns('user_notification_preferences', ['digest_frequency']);
};