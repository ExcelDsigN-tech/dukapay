import request from 'supertest';
import { jest } from '@jest/globals';
import { generateJwtToken } from '../services/authService.js';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

const VALID_API_KEY = 'test-internal-key';
const ADMIN_WALLET = 'GADMIN123456789AGENT';
const AGENT_A = 'GAGENTA123456789000000000000000000000000000000000001';
const AGENT_B = 'GAGENTB123456789000000000000000000000000000000000002';

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.INTERNAL_API_KEY = VALID_API_KEY;
process.env.ADMIN_WALLETS = ADMIN_WALLET;

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

await import('../db/connection.js');
const { default: app } = await import('../app.js');

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

afterEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.INTERNAL_API_KEY;
  delete process.env.JWT_SECRET;
  delete process.env.ADMIN_WALLETS;
});

describe('Agent Float Transfer API (/api/agents/float-transfer)', () => {
  describe('POST /api/agents/float-transfer (Initiate Transfer)', () => {
    it('successfully initiates a float transfer request with 1st approval', async () => {
      // Pair limits lookup
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Daily sum check
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });
      // Weekly sum check
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '0' }] });
      // INSERT transfer
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_12345',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            amount: '5000',
            reason: 'covering shortfalls',
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
            transfer_id: 'ft_12345',
            approver: AGENT_A,
            role: 'initiator',
            approved_at: new Date(),
          },
        ],
      });
      // INSERT audit_log
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/api/agents/float-transfer')
        .set(bearer(AGENT_A))
        .send({
          fromAgent: AGENT_A,
          toAgent: AGENT_B,
          amount: 5000,
          reason: 'covering shortfalls',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.transfer.id).toBe('ft_12345');
      expect(response.body.data.transfer.status).toBe('PENDING_APPROVAL');
      expect(response.body.data.approvals[0].approver).toBe(AGENT_A);
    });

    it('rejects self-transfer when fromAgent equals toAgent', async () => {
      const response = await request(app)
        .post('/api/agents/float-transfer')
        .set(bearer(AGENT_A))
        .send({
          fromAgent: AGENT_A,
          toAgent: AGENT_A,
          amount: 1000,
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/Self-transfer is not allowed/i);
    });

    it('rejects transfer exceeding pair daily limit', async () => {
      // Pair limits lookup (default 100000 daily)
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Daily sum check returning 95000
      mockQuery.mockResolvedValueOnce({ rows: [{ total: '95000' }] });

      const response = await request(app)
        .post('/api/agents/float-transfer')
        .set(bearer(AGENT_A))
        .send({
          fromAgent: AGENT_A,
          toAgent: AGENT_B,
          amount: 10000, // 95000 + 10000 > 100000
        });

      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/daily limit/i);
    });
  });

  describe('POST /api/agents/float-transfer/:id/approve (2-of-3 Workflow)', () => {
    it('successfully approves a pending transfer and completes it upon reaching 2-of-3 threshold', async () => {
      // SELECT transfer
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_12345',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            amount: '5000',
            status: 'PENDING_APPROVAL',
            required_approvals: 2,
            approval_count: 1,
            created_by: AGENT_A,
          },
        ],
      });
      // SELECT existing approval check
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // INSERT approval
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // INSERT audit_log for approval
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // UPDATE transfer to COMPLETED
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_12345',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            amount: '5000',
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
          { id: 1, transfer_id: 'ft_12345', approver: AGENT_A, role: 'initiator' },
          { id: 2, transfer_id: 'ft_12345', approver: AGENT_B, role: 'recipient' },
        ],
      });

      const response = await request(app)
        .post('/api/agents/float-transfer/ft_12345/approve')
        .set(bearer(AGENT_B))
        .send();

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.transfer.status).toBe('COMPLETED');
      expect(response.body.data.approvals.length).toBe(2);
    });

    it('rejects duplicate approval from the same approver', async () => {
      // SELECT transfer
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_12345',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            amount: '5000',
            status: 'PENDING_APPROVAL',
            required_approvals: 2,
            approval_count: 1,
          },
        ],
      });
      // SELECT existing approval check returning previous approval
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 1, transfer_id: 'ft_12345', approver: AGENT_A, role: 'initiator' }],
      });

      const response = await request(app)
        .post('/api/agents/float-transfer/ft_12345/approve')
        .set(bearer(AGENT_A))
        .send();

      expect(response.status).toBe(400);
      expect(response.body.error.message).toMatch(/already approved/i);
    });

    it('rejects approval from an unauthorized third party', async () => {
      const THIRD_PARTY = 'GTHIRD123456789000000000000000000000000000000000099';

      // SELECT transfer
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_12345',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            amount: '5000',
            status: 'PENDING_APPROVAL',
            required_approvals: 2,
            approval_count: 1,
          },
        ],
      });

      const response = await request(app)
        .post('/api/agents/float-transfer/ft_12345/approve')
        .set(bearer(THIRD_PARTY))
        .send();

      expect(response.status).toBe(403);
      expect(response.body.error.message).toMatch(/must be either the initiating agent, recipient agent, or an admin/i);
    });
  });

  describe('POST /api/agents/float-transfer/:id/reject', () => {
    it('allows recipient agent to reject transfer request', async () => {
      // SELECT transfer
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_12345',
            from_agent: AGENT_A,
            to_agent: AGENT_B,
            amount: '5000',
            status: 'PENDING_APPROVAL',
          },
        ],
      });
      // UPDATE transfer status to REJECTED
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 'ft_12345',
            status: 'REJECTED',
          },
        ],
      });
      // INSERT audit_log
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/api/agents/float-transfer/ft_12345/reject')
        .set(bearer(AGENT_B))
        .send();

      expect(response.status).toBe(200);
      expect(response.body.data.transfer.status).toBe('REJECTED');
    });
  });

  describe('GET /api/agents/float-transfer/limits & PUT /api/agents/float-transfer/limits', () => {
    it('gets configured or default pair limits', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ daily_limit: '150000', weekly_limit: '600000' }],
      });

      const response = await request(app)
        .get(`/api/agents/float-transfer/limits?fromAgent=${AGENT_A}&toAgent=${AGENT_B}`);

      expect(response.status).toBe(200);
      expect(response.body.data.dailyLimit).toBe(150000);
      expect(response.body.data.weeklyLimit).toBe(600000);
    });

    it('updates pair limits as admin', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // INSERT ON CONFLICT
      mockQuery.mockResolvedValueOnce({ rows: [] }); // Audit log

      const response = await request(app)
        .put('/api/agents/float-transfer/limits')
        .set(bearer(ADMIN_WALLET))
        .send({
          fromAgent: AGENT_A,
          toAgent: AGENT_B,
          dailyLimit: 200000,
          weeklyLimit: 800000,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.dailyLimit).toBe(200000);
      expect(response.body.data.weeklyLimit).toBe(800000);
    });
  });
});
