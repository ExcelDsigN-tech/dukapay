import { jest } from '@jest/globals';
import { AppError } from '../errors/AppError.js';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const AGENT_A = 'GAGENTA123456789000000000000000000000000000000000001';
const AGENT_B = 'GAGENTB123456789000000000000000000000000000000000002';
const ADMIN_USER = 'GADMIN123456789000000000000000000000000000000000000';
const THIRD_PARTY = 'GTHIRD123456789000000000000000000000000000000000099';

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

const mockBuildTransferToAgentTx = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    buildTransferToAgentTx: mockBuildTransferToAgentTx,
  },
}));

await import('../db/connection.js');
const { AgentFloatService, agentFloatService } = await import('../services/agentFloatService.js');

describe('AgentFloatService', () => {
  let service: AgentFloatService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AgentFloatService();
  });

  describe('getPairLimits', () => {
    it('returns custom pair limits when found in database', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ daily_limit: '250000', weekly_limit: '1000000' }],
      });

      const limits = await service.getPairLimits(AGENT_A, AGENT_B);

      expect(limits).toEqual({
        dailyLimit: 250000,
        weeklyLimit: 1000000,
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT daily_limit, weekly_limit FROM agent_float_transfer_limits'),
        [AGENT_A, AGENT_B],
      );
    });

    it('returns default limits when no custom limits are configured', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const limits = await service.getPairLimits(AGENT_A, AGENT_B);

      expect(limits).toEqual({
        dailyLimit: 100000,
        weeklyLimit: 500000,
      });
    });

    it('returns default limits when database query throws an error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB Connection error'));

      const limits = await service.getPairLimits(AGENT_A, AGENT_B);

      expect(limits).toEqual({
        dailyLimit: 100000,
        weeklyLimit: 500000,
      });
    });
  });

  describe('setPairLimits', () => {
    it('successfully sets pair limits and logs audit trail', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // DB INSERT ON CONFLICT
      mockQuery.mockResolvedValueOnce({ rows: [] }); // Audit log

      const result = await service.setPairLimits({
        fromAgent: AGENT_A,
        toAgent: AGENT_B,
        dailyLimit: 150000,
        weeklyLimit: 600000,
        updatedBy: ADMIN_USER,
      });

      expect(result).toEqual({
        fromAgent: AGENT_A,
        toAgent: AGENT_B,
        dailyLimit: 150000,
        weeklyLimit: 600000,
      });

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('INSERT INTO audit_logs'),
        expect.arrayContaining([ADMIN_USER, 'AGENT_FLOAT_TRANSFER_LIMITS_UPDATED']),
      );
    });

    it('throws error when fromAgent equals toAgent', async () => {
      await expect(
        service.setPairLimits({
          fromAgent: AGENT_A,
          toAgent: AGENT_A,
          dailyLimit: 100000,
          weeklyLimit: 500000,
          updatedBy: ADMIN_USER,
        }),
      ).rejects.toThrow(AppError);
    });

    it('throws error when dailyLimit or weeklyLimit is non-positive', async () => {
      await expect(
        service.setPairLimits({
          fromAgent: AGENT_A,
          toAgent: AGENT_B,
          dailyLimit: 0,
          weeklyLimit: 500000,
          updatedBy: ADMIN_USER,
        }),
      ).rejects.toThrow('Limits must be positive numbers');

      await expect(
        service.setPairLimits({
          fromAgent: AGENT_A,
          toAgent: AGENT_B,
          dailyLimit: 100000,
          weeklyLimit: -100,
          updatedBy: ADMIN_USER,
        }),
      ).rejects.toThrow('Limits must be positive numbers');
    });
  });

  describe('initiateTransfer & Limit Enforcement', () => {
    it('initiates a float transfer when limits are respected', async () => {
      // getPairLimits lookup -> default limits
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // daily sum check -> 10000
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '10000' }] });
      // weekly sum check -> 20000
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '20000' }] });
      // INSERT transfer
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_test_1',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            amount: '5000',
            reason: 'float rebalance',
            status: 'PENDING_APPROVAL',
            required_approvals: 2,
            approval_count: 1,
            created_by: AGENT_A,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });
      // INSERT approval
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            transfer_id: 'ft_test_1',
            approver: AGENT_A,
            role: 'initiator',
            approved_at: new Date(),
          },
        ],
      });
      // INSERT audit_log
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.initiateTransfer({
        fromAgent: AGENT_A,
        toAgent: AGENT_B,
        amount: 5000,
        reason: 'float rebalance',
        createdBy: AGENT_A,
      });

      expect(result.transfer.id).toBe('ft_test_1');
      expect(result.transfer.status).toBe('PENDING_APPROVAL');
      expect(result.approvals).toHaveLength(1);
      expect(result.approvals[0]?.role).toBe('initiator');
    });

    it('assigns role recipient when createdBy equals toAgent', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // limits lookup
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] }); // daily
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] }); // weekly
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_test_2',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            amount: '5000',
            status: 'PENDING_APPROVAL',
            required_approvals: 2,
            approval_count: 1,
            created_by: AGENT_B,
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, transfer_id: 'ft_test_2', approver: AGENT_B, role: 'recipient' }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // audit

      const result = await service.initiateTransfer({
        fromAgent: AGENT_A,
        toAgent: AGENT_B,
        amount: 5000,
        createdBy: AGENT_B,
      });

      expect(result.approvals[0]?.role).toBe('recipient');
    });

    it('assigns role admin when createdBy is a third party admin', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // limits lookup
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] }); // daily
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] }); // weekly
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_test_3',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            amount: '5000',
            status: 'PENDING_APPROVAL',
            required_approvals: 2,
            approval_count: 1,
            created_by: ADMIN_USER,
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, transfer_id: 'ft_test_3', approver: ADMIN_USER, role: 'admin' }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // audit

      const result = await service.initiateTransfer({
        fromAgent: AGENT_A,
        toAgent: AGENT_B,
        amount: 5000,
        createdBy: ADMIN_USER,
      });

      expect(result.approvals[0]?.role).toBe('admin');
    });

    it('rejects self-transfer initiation', async () => {
      await expect(
        service.initiateTransfer({
          fromAgent: AGENT_A,
          toAgent: AGENT_A,
          amount: 1000,
          createdBy: AGENT_A,
        }),
      ).rejects.toThrow('Self-transfer is not allowed.');
    });

    it('rejects non-positive amount initiation', async () => {
      await expect(
        service.initiateTransfer({
          fromAgent: AGENT_A,
          toAgent: AGENT_B,
          amount: 0,
          createdBy: AGENT_A,
        }),
      ).rejects.toThrow('Transfer amount must be positive.');
    });

    it('throws AppError when daily limit is exceeded', async () => {
      // Pair limits lookup (default 100000 daily)
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Daily sum check returning 95000
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '95000' }] });

      await expect(
        service.initiateTransfer({
          fromAgent: AGENT_A,
          toAgent: AGENT_B,
          amount: 10000, // 95000 + 10000 > 100000
          createdBy: AGENT_A,
        }),
      ).rejects.toThrow(/exceeds daily limit/i);
    });

    it('throws AppError when weekly limit is exceeded', async () => {
      // Pair limits lookup (default 500000 weekly)
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Daily sum check returning 10000
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '10000' }] });
      // Weekly sum check returning 495000
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '495000' }] });

      await expect(
        service.initiateTransfer({
          fromAgent: AGENT_A,
          toAgent: AGENT_B,
          amount: 10000, // 495000 + 10000 > 500000
          createdBy: AGENT_A,
        }),
      ).rejects.toThrow(/exceeds weekly limit/i);
    });
  });

  describe('approveTransfer (2-of-3 Multisig & Soroban Integration)', () => {
    it('executes second approval, completes transfer, and triggers Soroban call when configured', async () => {
      process.env.AGENT_VAULT_CONTRACT_ID = 'C123456789AGENTVAULT';
      mockBuildTransferToAgentTx.mockResolvedValueOnce({ unsignedTxXdr: 'AAAA...XDR' });

      // SELECT transfer
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_123',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            amount: '10000',
            status: 'PENDING_APPROVAL',
            required_approvals: 2,
            approval_count: 1,
            created_by: AGENT_A,
          },
        ],
      });
      // SELECT existing approval check -> none
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // INSERT approval
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // INSERT audit_log for approval
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // UPDATE transfer to COMPLETED
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_123',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            amount: '10000',
            status: 'COMPLETED',
            required_approvals: 2,
            approval_count: 2,
          },
        ],
      });
      // INSERT audit_log for execution
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // SELECT all approvals
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 1, transfer_id: 'ft_123', approver: AGENT_A, role: 'initiator' },
          { id: 2, transfer_id: 'ft_123', approver: AGENT_B, role: 'recipient' },
        ],
      });

      const result = await service.approveTransfer({
        transferId: 'ft_123',
        approver: AGENT_B,
      });

      expect(result.transfer.status).toBe('COMPLETED');
      expect(result.executedOnChain).toBe(true);
      expect(result.unsignedTxXdr).toBe('AAAA...XDR');
      expect(mockBuildTransferToAgentTx).toHaveBeenCalledWith(AGENT_A, AGENT_B, 10000);

      delete process.env.AGENT_VAULT_CONTRACT_ID;
    });

    it('handles Soroban service error gracefully without failing DB transfer completion', async () => {
      process.env.AGENT_VAULT_CONTRACT_ID = 'C123456789AGENTVAULT';
      mockBuildTransferToAgentTx.mockRejectedValueOnce(new Error('Soroban node offline'));

      // SELECT transfer
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_124',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            amount: '5000',
            status: 'PENDING_APPROVAL',
            required_approvals: 2,
            approval_count: 1,
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // check existing
      mockQuery.mockResolvedValueOnce({ rows: [] }); // insert approval
      mockQuery.mockResolvedValueOnce({ rows: [] }); // audit approval
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'ft_124', status: 'COMPLETED', approval_count: 2 }],
      }); // update COMPLETED
      mockQuery.mockResolvedValueOnce({ rows: [] }); // audit execution
      mockQuery.mockResolvedValueOnce({ rows: [] }); // fetch approvals

      const result = await service.approveTransfer({
        transferId: 'ft_124',
        approver: AGENT_B,
      });

      expect(result.transfer.status).toBe('COMPLETED');
      expect(result.executedOnChain).toBe(false);
      expect(result.unsignedTxXdr).toBeUndefined();

      delete process.env.AGENT_VAULT_CONTRACT_ID;
    });

    it('updates approval count without completing when required approvals threshold is not yet met', async () => {
      // SELECT transfer with required_approvals: 3
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_125',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            amount: '5000',
            status: 'PENDING_APPROVAL',
            required_approvals: 3,
            approval_count: 1,
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // check existing
      mockQuery.mockResolvedValueOnce({ rows: [] }); // insert approval
      mockQuery.mockResolvedValueOnce({ rows: [] }); // audit approval
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'ft_125', status: 'PENDING_APPROVAL', approval_count: 2 }],
      }); // UPDATE approval_count to 2
      mockQuery.mockResolvedValueOnce({ rows: [] }); // fetch approvals

      const result = await service.approveTransfer({
        transferId: 'ft_125',
        approver: AGENT_B,
      });

      expect(result.transfer.status).toBe('PENDING_APPROVAL');
      expect(result.transfer.approval_count).toBe(2);
      expect(result.executedOnChain).toBe(false);
    });

    it('allows admin role to approve transfer when approver is neither initiator nor recipient', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_126',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            amount: '5000',
            status: 'PENDING_APPROVAL',
            required_approvals: 2,
            approval_count: 1,
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'ft_126', status: 'COMPLETED', approval_count: 2 }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.approveTransfer({
        transferId: 'ft_126',
        approver: ADMIN_USER,
        userRole: 'admin',
      });

      expect(result.transfer.status).toBe('COMPLETED');
    });

    it('throws notFound when transfer ID does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.approveTransfer({
          transferId: 'non_existent_id',
          approver: AGENT_B,
        }),
      ).rejects.toThrow("Float transfer request 'non_existent_id' not found.");
    });

    it('throws badRequest when transfer is not in PENDING_APPROVAL status', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'ft_127', status: 'COMPLETED' }],
      });

      await expect(
        service.approveTransfer({
          transferId: 'ft_127',
          approver: AGENT_B,
        }),
      ).rejects.toThrow("Transfer is already in status 'COMPLETED'.");
    });

    it('throws forbidden when approver is unauthorized third party', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_128',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            status: 'PENDING_APPROVAL',
          },
        ],
      });

      await expect(
        service.approveTransfer({
          transferId: 'ft_128',
          approver: THIRD_PARTY,
        }),
      ).rejects.toThrow(/must be either the initiating agent, recipient agent, or an admin/i);
    });

    it('throws badRequest when approver has already approved the transfer', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_129',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            status: 'PENDING_APPROVAL',
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, transfer_id: 'ft_129', approver: AGENT_A }],
      });

      await expect(
        service.approveTransfer({
          transferId: 'ft_129',
          approver: AGENT_A,
        }),
      ).rejects.toThrow(`Approver '${AGENT_A}' has already approved this transfer.`);
    });
  });

  describe('rejectTransfer', () => {
    it('successfully rejects pending transfer by recipient agent', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_rej_1',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            status: 'PENDING_APPROVAL',
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'ft_rej_1', status: 'REJECTED' }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // audit log

      const result = await service.rejectTransfer({
        transferId: 'ft_rej_1',
        rejector: AGENT_B,
      });

      expect(result.status).toBe('REJECTED');
    });

    it('successfully rejects pending transfer by admin', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_rej_2',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            status: 'PENDING_APPROVAL',
          },
        ],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'ft_rej_2', status: 'REJECTED' }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await service.rejectTransfer({
        transferId: 'ft_rej_2',
        rejector: ADMIN_USER,
        userRole: 'admin',
      });

      expect(result.status).toBe('REJECTED');
    });

    it('throws notFound for non-existent transfer', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.rejectTransfer({
          transferId: 'unknown_id',
          rejector: AGENT_A,
        }),
      ).rejects.toThrow("Float transfer request 'unknown_id' not found.");
    });

    it('throws badRequest for non-pending transfer rejection', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'ft_rej_3', status: 'REJECTED' }],
      });

      await expect(
        service.rejectTransfer({
          transferId: 'ft_rej_3',
          rejector: AGENT_A,
        }),
      ).rejects.toThrow("Transfer is already in status 'REJECTED'.");
    });

    it('throws forbidden when third party attempts to reject transfer', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_rej_4',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            status: 'PENDING_APPROVAL',
          },
        ],
      });

      await expect(
        service.rejectTransfer({
          transferId: 'ft_rej_4',
          rejector: THIRD_PARTY,
        }),
      ).rejects.toThrow('Only the initiator, recipient, or an admin can reject this transfer request.');
    });
  });

  describe('getTransferDetails', () => {
    it('returns transfer details along with approvals and audit logs', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'ft_detail_1', from_agent: AGENT_A, to_agent: AGENT_B }],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, transfer_id: 'ft_detail_1', approver: AGENT_A, role: 'initiator' }],
      });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 100, action: 'AGENT_FLOAT_TRANSFER_INITIATED' }],
      });

      const details = await service.getTransferDetails('ft_detail_1');

      expect(details.transfer.id).toBe('ft_detail_1');
      expect(details.approvals).toHaveLength(1);
      expect(details.auditLogs).toHaveLength(1);
    });

    it('throws notFound when transfer ID does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(service.getTransferDetails('invalid_id')).rejects.toThrow(
        "Float transfer request 'invalid_id' not found.",
      );
    });
  });

  describe('listTransfers', () => {
    it('lists transfers with default pagination and without filters', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '5' }] });
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'ft_1', status: 'PENDING_APPROVAL' },
          { id: 'ft_2', status: 'COMPLETED' },
        ],
      });

      const res = await service.listTransfers({});

      expect(res.total).toBe(5);
      expect(res.transfers).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT COUNT(*) as total FROM agent_float_transfers'),
        expect.any(Array),
      );
    });

    it('applies agent and status filters with custom limit and offset', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '1' }] });
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'ft_1', from_agent: AGENT_A, status: 'COMPLETED' }],
      });

      const res = await service.listTransfers({
        agent: AGENT_A,
        status: 'COMPLETED',
        limit: 10,
        offset: 0,
      });

      expect(res.total).toBe(1);
      expect(res.transfers).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('(from_agent = $1 OR to_agent = $1) AND status = $2'),
        expect.any(Array),
      );
    });
  });

  describe('logAudit error handling', () => {
    it('handles database error during audit logging without breaking caller flow', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // setPairLimits DB query
      mockQuery.mockRejectedValueOnce(new Error('Audit DB write error')); // Audit log error

      const result = await service.setPairLimits({
        fromAgent: AGENT_A,
        toAgent: AGENT_B,
        dailyLimit: 100000,
        weeklyLimit: 500000,
        updatedBy: ADMIN_USER,
      });

      expect(result).toBeDefined();
    });
  });
});
