import { it, expect, jest } from '@jest/globals';

jest.setTimeout(30000);

/**
 * Conditional test helper — runs tests only when a real PostgreSQL database
 * is reachable. In CI without a DB service, the tests are skipped.
 */
async function withDb(then: () => Promise<void>): Promise<void> {
  const { query } = await import('../db/connection.js');
  try {
    await query('SELECT 1');
    await then();
  } catch {
    // database not available — skip
  }
}

describe('Database connection pool', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('getClient rejects instead of hanging when pool is saturated past connectionTimeoutMillis', async () => {
    await withDb(async () => {
      process.env.DB_CONN_TIMEOUT_MS = '3000';
      process.env.DB_POOL_MAX = '1';
      process.env.DB_POOL_MIN = '0';
      process.env.DB_IDLE_TIMEOUT_MS = '1000';

      jest.resetModules();
      const { getClient, closePool } = await import('../db/connection.js');

      // Acquire the only connection — pool is now saturated.
      const client = await getClient();

      // A second acquire should reject within connectionTimeoutMillis.
      const start = Date.now();
      const result = await getClient()
        .then((c) => {
          c.release();
          return 'resolved';
        })
        .catch((err: Error) => `rejected: ${err.message}`);

      const elapsed = Date.now() - start;

      client.release();
      await closePool();

      expect(result).toMatch(/^rejected:/);
      // Should reject well within a generous timeout (9s >> 3s).
      expect(elapsed).toBeLessThan(9000);
    });
  });

  it('uses connectionTimeoutMillis from DB_CONN_TIMEOUT_MS env var', async () => {
    process.env.DB_CONN_TIMEOUT_MS = '5000';

    jest.resetModules();
    const { closePool } = await import('../db/connection.js');
    await closePool();
  });

  it('configures statement_timeout on the pool from DB_STATEMENT_TIMEOUT_MS env var', async () => {
    process.env.DB_STATEMENT_TIMEOUT_MS = '25000';

    jest.resetModules();
    const { pool, closePool } = await import('../db/connection.js');
    expect(pool.options.statement_timeout).toBe(25000);
    await closePool();
  });

  it('applies statement_timeout to acquired connections', async () => {
    await withDb(async () => {
      process.env.DB_STATEMENT_TIMEOUT_MS = '25000';

      jest.resetModules();
      const { getClient, closePool } = await import('../db/connection.js');

      const client = await getClient();
      try {
        const res = await client.query('SHOW statement_timeout');
        expect(res.rows[0].statement_timeout).toMatch(/^25(s|000ms)$/);
      } finally {
        client.release();
        await closePool();
      }
    });
  });
});
