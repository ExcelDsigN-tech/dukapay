/**
 * Migration: Agent-to-Agent Float Transfers & Limits
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  pgm.createTable('agent_float_transfer_limits', {
    id: 'id',
    from_agent: { type: 'varchar(255)', notNull: true },
    to_agent: { type: 'varchar(255)', notNull: true },
    daily_limit: { type: 'numeric', notNull: true, default: '100000' },
    weekly_limit: { type: 'numeric', notNull: true, default: '500000' },
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
  });

  pgm.addConstraint(
    'agent_float_transfer_limits',
    'unique_agent_pair_limits',
    'UNIQUE(from_agent, to_agent)',
  );
  pgm.createIndex('agent_float_transfer_limits', 'from_agent');
  pgm.createIndex('agent_float_transfer_limits', 'to_agent');

  pgm.createTable('agent_float_transfers', {
    id: { type: 'varchar(255)', primaryKey: true },
    from_agent: { type: 'varchar(255)', notNull: true },
    to_agent: { type: 'varchar(255)', notNull: true },
    amount: { type: 'numeric', notNull: true },
    reason: { type: 'varchar(255)', notNull: false },
    status: { type: 'varchar(50)', notNull: true, default: 'PENDING_APPROVAL' },
    required_approvals: { type: 'integer', notNull: true, default: 2 },
    approval_count: { type: 'integer', notNull: true, default: 1 },
    created_by: { type: 'varchar(255)', notNull: true },
    tx_hash: { type: 'varchar(255)', notNull: false },
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
  });

  pgm.createIndex('agent_float_transfers', 'from_agent');
  pgm.createIndex('agent_float_transfers', 'to_agent');
  pgm.createIndex('agent_float_transfers', 'status');
  pgm.createIndex('agent_float_transfers', 'created_at');

  pgm.createTable('agent_float_transfer_approvals', {
    id: 'id',
    transfer_id: {
      type: 'varchar(255)',
      notNull: true,
      references: 'agent_float_transfers',
      onDelete: 'CASCADE',
    },
    approver: { type: 'varchar(255)', notNull: true },
    role: { type: 'varchar(50)', notNull: true },
    approved_at: {
      type: 'timestamp',
      notNull: true,
      default: pgm.func('current_timestamp'),
    },
  });

  pgm.addConstraint(
    'agent_float_transfer_approvals',
    'unique_transfer_approver',
    'UNIQUE(transfer_id, approver)',
  );
  pgm.createIndex('agent_float_transfer_approvals', 'transfer_id');
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable('agent_float_transfer_approvals');
  pgm.dropTable('agent_float_transfers');
  pgm.dropTable('agent_float_transfer_limits');
};
