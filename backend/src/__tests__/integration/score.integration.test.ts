import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { query, getClient } from '../../db/connection.js';
import { generateJwtToken } from '../../services/authService.js';
import type { PoolClient } from 'pg';

let dbAvailable = false;

beforeAll(async () => {
  try {
    await query('SELECT 1');
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

const describeIfDb = (name: string, fn: () => void) => {
  if (dbAvailable || process.env.INTEGRATION_TESTS === 'true') {
    describe(name, fn);
  } else {
    describe.skip(`${name} (skipped: no database)`, fn);
  }
};

describeIfDb('Integration: Scores API against real schema', () => {
  let app: any;
  let client: PoolClient;
  const testBorrower = 'G_INTEGRATION_TEST_BORROWER_1';

  beforeAll(async () => {
    client = await getClient();
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-min-32-chars-long!!';
    process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'test-internal-key';

    const appModule = await import('../../app.js');
    app = appModule.default;

    // Ensure clean state
    await query('DELETE FROM scores WHERE borrower = $1', [testBorrower]);
  });

  afterAll(async () => {
    try {
      await query('DELETE FROM scores WHERE borrower = $1', [testBorrower]);
    } catch {
      // ignore cleanup errors
    }
    if (client) {
      client.release();
    }
  });

  it('queries scores with real borrower and score columns', async () => {
    // Insert test score record using real schema
    await query(
      `INSERT INTO scores (borrower, score)
       VALUES ($1, $2)
       ON CONFLICT (borrower) DO UPDATE SET score = EXCLUDED.score`,
      [testBorrower, 720],
    );

    const token = generateJwtToken(testBorrower);
    const response = await request(app)
      .get(`/api/score/${testBorrower}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.userId).toBe(testBorrower);
    expect(response.body.score).toBe(720);
    expect(response.body.band).toBe('Good');
  });

  it('returns default score 500 when borrower has no score record in real database', async () => {
    const nonExistent = 'G_INTEGRATION_NON_EXISTENT_BORROWER';
    await query('DELETE FROM scores WHERE borrower = $1', [nonExistent]);

    const token = generateJwtToken(nonExistent);
    const response = await request(app)
      .get(`/api/score/${nonExistent}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.score).toBe(500);
  });

  it('updates score via POST /api/score/update against real schema', async () => {
    const response = await request(app)
      .post('/api/score/update')
      .set('x-api-key', process.env.INTERNAL_API_KEY || 'test-internal-key')
      .send({ userId: testBorrower, repaymentAmount: 100, onTime: true });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.newScore).toBe(735); // 720 + 15

    // Verify persisted directly in the database
    const dbResult = await query('SELECT score FROM scores WHERE borrower = $1', [testBorrower]);
    expect(Number(dbResult.rows[0].score)).toBe(735);
  });
});
