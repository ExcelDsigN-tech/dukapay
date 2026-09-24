import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import express, { type Request, type Response } from 'express';
import {
  csrfProtection,
  getCsrfTokenController,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  generateCsrfToken,
} from '../csrf.js';
import { errorHandler } from '../errorHandler.js';

describe('CSRF Protection Middleware', () => {
  const createTestApp = () => {
    const app = express();
    app.use(express.json());
    app.use(csrfProtection());

    app.get('/api/v1/auth/csrf', getCsrfTokenController);
    app.get('/api/test-safe', (_req: Request, res: Response) => {
      res.json({ success: true, message: 'safe' });
    });
    app.post('/api/test-mutate', (_req: Request, res: Response) => {
      res.json({ success: true, message: 'mutated' });
    });
    app.put('/api/test-put', (_req: Request, res: Response) => {
      res.json({ success: true, message: 'updated' });
    });
    app.delete('/api/test-delete', (_req: Request, res: Response) => {
      res.json({ success: true, message: 'deleted' });
    });
    app.post('/api/v1/auth/challenge', (_req: Request, res: Response) => {
      res.json({ success: true, message: 'exempt challenge' });
    });

    app.use(errorHandler);
    return app;
  };

  it('should allow safe GET requests without CSRF token and attach CSRF cookie', async () => {
    const app = createTestApp();
    const response = await request(app).get('/api/test-safe').expect(200);

    expect(response.body.success).toBe(true);
    const cookies = response.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain(CSRF_COOKIE_NAME);
    expect(cookies[0]).toContain('SameSite=Strict');
  });

  it('should issue CSRF token via GET /api/v1/auth/csrf', async () => {
    const app = createTestApp();
    const response = await request(app).get('/api/v1/auth/csrf').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.csrfToken).toBeDefined();
    expect(response.body.data.csrfToken.length).toBe(64); // 32 bytes hex
  });

  it('should reject mutating POST request when CSRF token is missing', async () => {
    const app = createTestApp();
    const response = await request(app).post('/api/test-mutate').send({ amount: 100 }).expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('CSRF token');
  });

  it('should reject mutating POST request when CSRF token is invalid/mismatched', async () => {
    const app = createTestApp();
    const token1 = generateCsrfToken();
    const token2 = generateCsrfToken();

    const response = await request(app)
      .post('/api/test-mutate')
      .set('Cookie', `${CSRF_COOKIE_NAME}=${token1}`)
      .set(CSRF_HEADER_NAME, token2)
      .send({ amount: 100 })
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.message).toContain('Invalid CSRF token');
  });

  it('should accept mutating POST request when CSRF cookie and X-CSRF-Token match', async () => {
    const app = createTestApp();
    const token = generateCsrfToken();

    const response = await request(app)
      .post('/api/test-mutate')
      .set('Cookie', `${CSRF_COOKIE_NAME}=${token}`)
      .set(CSRF_HEADER_NAME, token)
      .send({ amount: 100 })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('mutated');
  });

  it('should accept mutating PUT and DELETE requests with valid CSRF token', async () => {
    const app = createTestApp();
    const token = generateCsrfToken();

    const putResp = await request(app)
      .put('/api/test-put')
      .set('Cookie', `${CSRF_COOKIE_NAME}=${token}`)
      .set(CSRF_HEADER_NAME, token)
      .send({ key: 'val' })
      .expect(200);
    expect(putResp.body.success).toBe(true);

    const deleteResp = await request(app)
      .delete('/api/test-delete')
      .set('Cookie', `${CSRF_COOKIE_NAME}=${token}`)
      .set(CSRF_HEADER_NAME, token)
      .expect(200);
    expect(deleteResp.body.success).toBe(true);
  });

  it('should exempt configured exempt paths from CSRF check', async () => {
    const app = createTestApp();
    const response = await request(app)
      .post('/api/v1/auth/challenge')
      .send({ publicKey: 'G...' })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('exempt challenge');
  });
});
