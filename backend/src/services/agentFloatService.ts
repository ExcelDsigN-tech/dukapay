import crypto from 'node:crypto';
import { query } from '../db/connection.js';
import { AppError } from '../errors/AppError.js';
import logger from '../utils/logger.js';
import { sorobanService } from './sorobanService.js';

export interface InitiateTransferInput {
  fromAgent: string;
  toAgent: string;
  amount: number;
  reason?: string | undefined;
  createdBy: string;
}

export interface ApproveTransferInput {
  transferId: string;
  approver: string;
  userRole?: string | undefined;
}

export interface RejectTransferInput {
  transferId: string;
  rejector: string;
  userRole?: string | undefined;
}

export interface SetLimitsInput {
  fromAgent: string;
  toAgent: string;
  dailyLimit: number;
  weeklyLimit: number;
  updatedBy: string;
}

export interface AgentFloatTransferRow {
  id: string;
  from_agent: string;
  to_agent: string;
  amount: string;
  reason: string | null;
  status: 'PENDING_APPROVAL' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
  required_approvals: number;
  approval_count: number;
  created_by: string;
  tx_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TransferApprovalRow {
  id: number;
  transfer_id: string;
  approver: string;
  role: string;
  approved_at: Date;
}

export interface TransferLimitsRow {
  id: number;
  from_agent: string;
  to_agent: string;
  daily_limit: string;
  weekly_limit: string;
  created_at: Date;
  updated_at: Date;
}

const DEFAULT_DAILY_LIMIT = 100_000;
const DEFAULT_WEEKLY_LIMIT = 500_000;

export class AgentFloatService {
  /**
   * Get configured or default limits for an agent pair.
   */
  async getPairLimits(
    fromAgent: string,
    toAgent: string,
  ): Promise<{ dailyLimit: number; weeklyLimit: number }> {
    try {
      const res = await query(
        `SELECT daily_limit, weekly_limit FROM agent_float_transfer_limits
         WHERE from_agent = $1 AND to_agent = $2`,
        [fromAgent, toAgent],
      );

      if (res.rows.length > 0) {
        const row = res.rows[0] as { daily_limit: string; weekly_limit: string };
        return {
          dailyLimit: Number(row.daily_limit),
          weeklyLimit: Number(row.weekly_limit),
        };
      }
    } catch (err) {
      logger.warn('Failed to fetch pair limits from DB, using defaults', { err });
    }

    return {
      dailyLimit: DEFAULT_DAILY_LIMIT,
      weeklyLimit: DEFAULT_WEEKLY_LIMIT,
    };
  }

  /**
   * Set or update limits for an agent pair (Admin operation).
   */
  async setPairLimits(input: SetLimitsInput): Promise<{
    fromAgent: string;
    toAgent: string;
    dailyLimit: number;
    weeklyLimit: number;
  }> {
    const { fromAgent, toAgent, dailyLimit, weeklyLimit, updatedBy } = input;

    if (fromAgent === toAgent) {
      throw AppError.badRequest('fromAgent and toAgent must be different');
    }
    if (dailyLimit <= 0 || weeklyLimit <= 0) {
      throw AppError.badRequest('Limits must be positive numbers');
    }

    await query(
      `INSERT INTO agent_float_transfer_limits (from_agent, to_agent, daily_limit, weekly_limit, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (from_agent, to_agent)
       DO UPDATE SET daily_limit = EXCLUDED.daily_limit, weekly_limit = EXCLUDED.weekly_limit, updated_at = NOW()`,
      [fromAgent, toAgent, dailyLimit, weeklyLimit],
    );

    // Audit log
    await this.logAudit({
      actor: updatedBy,
      action: 'AGENT_FLOAT_TRANSFER_LIMITS_UPDATED',
      target: `Pair:${fromAgent}->${toAgent}`,
      payload: { dailyLimit, weeklyLimit },
      status: 200,
    });

    return { fromAgent, toAgent, dailyLimit, weeklyLimit };
  }

  /**
   * Check if transfer amount respects daily and weekly limits.
   */
  private async checkLimits(fromAgent: string, toAgent: string, amount: number): Promise<void> {
    const limits = await this.getPairLimits(fromAgent, toAgent);

    // Check rolling 24-hour total
    const dailyRes = await query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM agent_float_transfers
       WHERE from_agent = $1 AND to_agent = $2
         AND status IN ('PENDING_APPROVAL', 'COMPLETED')
         AND created_at >= NOW() - INTERVAL '24 hours'`,
      [fromAgent, toAgent],
    );

    const dailyTotal = Number((dailyRes.rows[0] as { total: string }).total);
    if (dailyTotal + amount > limits.dailyLimit) {
      throw AppError.badRequest(
        `Transfer exceeds daily limit of ${limits.dailyLimit} for this agent pair. Current 24h total: ${dailyTotal}, requested: ${amount}`,
      );
    }

    // Check rolling 7-day total
    const weeklyRes = await query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM agent_float_transfers
       WHERE from_agent = $1 AND to_agent = $2
         AND status IN ('PENDING_APPROVAL', 'COMPLETED')
         AND created_at >= NOW() - INTERVAL '7 days'`,
      [fromAgent, toAgent],
    );

    const weeklyTotal = Number((weeklyRes.rows[0] as { total: string }).total);
    if (weeklyTotal + amount > limits.weeklyLimit) {
      throw AppError.badRequest(
        `Transfer exceeds weekly limit of ${limits.weeklyLimit} for this agent pair. Current 7-day total: ${weeklyTotal}, requested: ${amount}`,
      );
    }
  }

  /**
   * Initiate a new agent-to-agent float transfer request.
   */
  async initiateTransfer(input: InitiateTransferInput): Promise<{
    transfer: AgentFloatTransferRow;
    approvals: TransferApprovalRow[];
  }> {
    const { fromAgent, toAgent, amount, reason, createdBy } = input;

    if (fromAgent === toAgent) {
      throw AppError.badRequest('Self-transfer is not allowed. fromAgent and toAgent must be different.');
    }
    if (!amount || amount <= 0) {
      throw AppError.badRequest('Transfer amount must be positive.');
    }

    // Enforce daily/weekly pair limits
    await this.checkLimits(fromAgent, toAgent, amount);

    const transferId = `ft_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const initialRole =
      createdBy === fromAgent ? 'initiator' : createdBy === toAgent ? 'recipient' : 'admin';

    // Insert transfer record
    const transferRes = await query(
      `INSERT INTO agent_float_transfers
       (id, from_agent, to_agent, amount, reason, status, required_approvals, approval_count, created_by)
       VALUES ($1, $2, $3, $4, $5, 'PENDING_APPROVAL', 2, 1, $6)
       RETURNING *`,
      [transferId, fromAgent, toAgent, amount, reason ?? null, createdBy],
    );

    const transfer = transferRes.rows[0] as AgentFloatTransferRow;

    // Insert initial approval
    const approvalRes = await query(
      `INSERT INTO agent_float_transfer_approvals (transfer_id, approver, role)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [transferId, createdBy, initialRole],
    );

    const approvals = approvalRes.rows as TransferApprovalRow[];

    // Log immutable audit trail
    await this.logAudit({
      actor: createdBy,
      action: 'AGENT_FLOAT_TRANSFER_INITIATED',
      target: `TransferID:${transferId}`,
      payload: { fromAgent, toAgent, amount, reason, role: initialRole },
      status: 201,
    });

    return { transfer, approvals };
  }

  /**
   * Approve an existing float transfer (2-of-3 multisig workflow).
   */
  async approveTransfer(input: ApproveTransferInput): Promise<{
    transfer: AgentFloatTransferRow;
    approvals: TransferApprovalRow[];
    executedOnChain?: boolean;
    unsignedTxXdr?: string;
  }> {
    const { transferId, approver, userRole } = input;

    const transferRes = await query(`SELECT * FROM agent_float_transfers WHERE id = $1`, [
      transferId,
    ]);
    if (transferRes.rows.length === 0) {
      throw AppError.notFound(`Float transfer request '${transferId}' not found.`);
    }

    const transfer = transferRes.rows[0] as AgentFloatTransferRow;

    if (transfer.status !== 'PENDING_APPROVAL') {
      throw AppError.badRequest(`Transfer is already in status '${transfer.status}'.`);
    }

    // Determine approver role
    let role: string;
    if (approver === transfer.from_agent) {
      role = 'initiator';
    } else if (approver === transfer.to_agent) {
      role = 'recipient';
    } else if (userRole === 'admin') {
      role = 'admin';
    } else {
      throw AppError.forbidden(
        'Approver must be either the initiating agent, recipient agent, or an admin.',
      );
    }

    // Check if already approved by this approver
    const existingApproval = await query(
      `SELECT * FROM agent_float_transfer_approvals WHERE transfer_id = $1 AND approver = $2`,
      [transferId, approver],
    );
    if (existingApproval.rows.length > 0) {
      throw AppError.badRequest(`Approver '${approver}' has already approved this transfer.`);
    }

    // Insert approval
    await query(
      `INSERT INTO agent_float_transfer_approvals (transfer_id, approver, role)
       VALUES ($1, $2, $3)`,
      [transferId, approver, role],
    );

    const newCount = transfer.approval_count + 1;

    // Log approval audit entry
    await this.logAudit({
      actor: approver,
      action: 'AGENT_FLOAT_TRANSFER_APPROVED',
      target: `TransferID:${transferId}`,
      payload: { role, approvalCount: newCount },
      status: 200,
    });

    let updatedTransfer = transfer;
    let unsignedTxXdr: string | undefined;
    let executedOnChain = false;

    // Threshold check (2-of-3)
    if (newCount >= transfer.required_approvals) {
      // Execute the float transfer on Soroban contract if configured
      try {
        if (process.env.AGENT_VAULT_CONTRACT_ID) {
          const result = await sorobanService.buildTransferToAgentTx(
            transfer.from_agent,
            transfer.to_agent,
            Number(transfer.amount),
          );
          unsignedTxXdr = result.unsignedTxXdr;
        }
        executedOnChain = true;
      } catch (err) {
        logger.warn('Soroban contract execution deferred or skipped', { err });
      }

      const updateRes = await query(
        `UPDATE agent_float_transfers
         SET status = 'COMPLETED', approval_count = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [transferId, newCount],
      );
      updatedTransfer = updateRes.rows[0] as AgentFloatTransferRow;

      // Log execution audit entry
      await this.logAudit({
        actor: approver,
        action: 'AGENT_FLOAT_TRANSFER_EXECUTED',
        target: `TransferID:${transferId}`,
        payload: {
          fromAgent: transfer.from_agent,
          toAgent: transfer.to_agent,
          amount: transfer.amount,
          executedOnChain,
        },
        status: 200,
      });
    } else {
      const updateRes = await query(
        `UPDATE agent_float_transfers
         SET approval_count = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [transferId, newCount],
      );
      updatedTransfer = updateRes.rows[0] as AgentFloatTransferRow;
    }

    const approvalsRes = await query(
      `SELECT * FROM agent_float_transfer_approvals WHERE transfer_id = $1 ORDER BY approved_at ASC`,
      [transferId],
    );

    return {
      transfer: updatedTransfer,
      approvals: approvalsRes.rows as TransferApprovalRow[],
      executedOnChain,
      ...(unsignedTxXdr ? { unsignedTxXdr } : {}),
    };
  }

  /**
   * Reject a float transfer request.
   */
  async rejectTransfer(input: RejectTransferInput): Promise<AgentFloatTransferRow> {
    const { transferId, rejector, userRole } = input;

    const transferRes = await query(`SELECT * FROM agent_float_transfers WHERE id = $1`, [
      transferId,
    ]);
    if (transferRes.rows.length === 0) {
      throw AppError.notFound(`Float transfer request '${transferId}' not found.`);
    }

    const transfer = transferRes.rows[0] as AgentFloatTransferRow;

    if (transfer.status !== 'PENDING_APPROVAL') {
      throw AppError.badRequest(`Transfer is already in status '${transfer.status}'.`);
    }

    // Check rejector permission
    const isInitiator = rejector === transfer.from_agent;
    const isRecipient = rejector === transfer.to_agent;
    const isAdmin = userRole === 'admin';

    if (!isInitiator && !isRecipient && !isAdmin) {
      throw AppError.forbidden(
        'Only the initiator, recipient, or an admin can reject this transfer request.',
      );
    }

    const updateRes = await query(
      `UPDATE agent_float_transfers
       SET status = 'REJECTED', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [transferId],
    );

    const updatedTransfer = updateRes.rows[0] as AgentFloatTransferRow;

    // Log rejection audit entry
    await this.logAudit({
      actor: rejector,
      action: 'AGENT_FLOAT_TRANSFER_REJECTED',
      target: `TransferID:${transferId}`,
      payload: { rejector, previousStatus: transfer.status },
      status: 200,
    });

    return updatedTransfer;
  }

  /**
   * Get single transfer details with approvals and audit logs.
   */
  async getTransferDetails(transferId: string): Promise<{
    transfer: AgentFloatTransferRow;
    approvals: TransferApprovalRow[];
    auditLogs: Array<Record<string, unknown>>;
  }> {
    const transferRes = await query(`SELECT * FROM agent_float_transfers WHERE id = $1`, [
      transferId,
    ]);
    if (transferRes.rows.length === 0) {
      throw AppError.notFound(`Float transfer request '${transferId}' not found.`);
    }

    const transfer = transferRes.rows[0] as AgentFloatTransferRow;

    const approvalsRes = await query(
      `SELECT * FROM agent_float_transfer_approvals WHERE transfer_id = $1 ORDER BY approved_at ASC`,
      [transferId],
    );

    const auditRes = await query(
      `SELECT * FROM audit_logs WHERE target = $1 ORDER BY created_at ASC`,
      [`TransferID:${transferId}`],
    );

    return {
      transfer,
      approvals: approvalsRes.rows as TransferApprovalRow[],
      auditLogs: auditRes.rows as Array<Record<string, unknown>>,
    };
  }

  /**
   * List transfers with optional filters.
   */
  async listTransfers(filters: {
    agent?: string | undefined;
    status?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<{ transfers: AgentFloatTransferRow[]; total: number }> {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const offset = Math.max(filters.offset ?? 0, 0);

    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filters.agent) {
      values.push(filters.agent);
      conditions.push(`(from_agent = $${values.length} OR to_agent = $${values.length})`);
    }

    if (filters.status) {
      values.push(filters.status);
      conditions.push(`status = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(
      `SELECT COUNT(*) as total FROM agent_float_transfers ${whereClause}`,
      values,
    );
    const total = Number((countRes.rows[0] as { total: string }).total);

    values.push(limit, offset);
    const transfersRes = await query(
      `SELECT * FROM agent_float_transfers ${whereClause} ORDER BY created_at DESC LIMIT $${
        values.length - 1
      } OFFSET $${values.length}`,
      values,
    );

    return {
      transfers: transfersRes.rows as AgentFloatTransferRow[],
      total,
    };
  }

  /**
   * Helper to insert immutable audit log entries.
   */
  private async logAudit(entry: {
    actor: string;
    action: string;
    target: string;
    payload: Record<string, unknown>;
    status: number;
  }): Promise<void> {
    try {
      await query(
        `INSERT INTO audit_logs (actor, action, target, payload, status, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [entry.actor, entry.action, entry.target, JSON.stringify(entry.payload), entry.status],
      );
    } catch (err) {
      logger.error('Failed to insert audit log entry for float transfer', { err, entry });
    }
  }
}

export const agentFloatService = new AgentFloatService();
