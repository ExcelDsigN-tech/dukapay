/**
 * Issue #495: Integration tests asserting the loan write routes
 * `POST /api/loans/:loanId/build-cancel` and
 * `POST /api/loans/:loanId/contest-default` enforce `requireScopes` so that a
 * caller holding only read capabilities (e.g. an API key / JWT minted with the
 * narrow `read:loans` scope) cannot construct loan-cancel or contest-default
 * transactions. Scope enforcement happens before any downstream handler, so no
 * DB is required for these assertions.
 */

import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const BORROWER = 'GBORROWER111111111111111111111111111111111111111111111111';

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-loanroutes';

const app = (await import('../app.js')).default;
const JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-loanroutes';

function mintToken(publicKey: string, scopes: string[]): string {
  return jwt.sign({ publicKey, role: 'borrower', scopes }, JWT_SECRET, {
    expiresIn: '1h',
    algorithm: 'HS256',
  });
}

// Borrower-scope token that can read loans but holds no write capability.
const readOnlyToken = mintToken(BORROWER, ['read:loans']);
// Full borrower write scope — passes the scope gate (downstream may still fail
// on missing DB, but must not be rejected by the authz layer).
const writeToken = mintToken(BORROWER, ['read:loans', 'write:loans']);

const LOAN_WRITE_ROUTES = [
  { method: 'post', path: '/api/loans/loan-123/build-cancel' },
  { method: 'post', path: '/api/loans/loan-123/contest-default' },
] as const;

describe('Loan write route scope authorization (#495)', () => {
  describe('read-only borrower JWT (read:loans, missing write:loans)', () => {
    for (const route of LOAN_WRITE_ROUTES) {
      it(`${route.method.toUpperCase()} ${route.path} → 403`, async () => {
        const res = await request(app)
          [route.method](route.path)
          .set('Authorization', `Bearer ${readOnlyToken}`)
          .send({});

        expect(res.status).toBe(403);
      });
    }
  });

  describe('write-capable borrower JWT (write:loans)', () => {
    for (const route of LOAN_WRITE_ROUTES) {
      it(`${route.method.toUpperCase()} ${route.path} → not 403 by scope (authz passes)`, async () => {
        const res = await request(app)
          [route.method](route.path)
          .set('Authorization', `Bearer ${writeToken}`)
          .send({});

        // Scope gate passes; downstream may fail on the missing loan/DB, but
        // the request must not be rejected for missing write:loans.
        expect(res.status).not.toBe(403);
      });
    }
  });

  describe('unauthenticated request', () => {
    for (const route of LOAN_WRITE_ROUTES) {
      it(`${route.method.toUpperCase()} ${route.path} → 401`, async () => {
        const res = await request(app)[route.method](route.path).send({});

        expect(res.status).toBe(401);
      });
    }
  });
});
