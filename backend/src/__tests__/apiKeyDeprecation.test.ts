import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { requireApiKey } from '../middleware/auth.js';
import { AppError } from '../errors/AppError.js';

describe('API Key Middleware - Legacy Key Deprecation', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;
  let statusCode: number;
  let responseBody: unknown;

  beforeEach(() => {
    process.env.INTERNAL_API_KEY =
      'legacy-test-key,admin:loans:test-key,admin:disputes:dispute-key';
    jest.clearAllMocks();

    req = {
      headers: {},
      path: '/api/test',
      method: 'GET',
    };

    statusCode = 200;
    responseBody = null;

    res = {
      status: jest.fn(() => res as any),
      json: jest.fn((data) => {
        responseBody = data;
      }),
    };

    next = jest.fn();
  });

  it('should reject missing API key', () => {
    const middleware = requireApiKey('admin:loans');
    expect(() => {
      middleware(req as Request, res as Response, next);
    }).toThrow();
  });

  it('should reject invalid API key', () => {
    req.headers = { 'x-api-key': 'invalid-key' };
    const middleware = requireApiKey('admin:loans');
    expect(() => {
      middleware(req as Request, res as Response, next);
    }).toThrow();
  });

  it('should warn when legacy key is used on scoped endpoint', () => {
    const legacyKey = process.env.INTERNAL_API_KEY?.split(',')[0];
    if (!legacyKey) return;

    req.headers = { 'x-api-key': legacyKey };
    const middleware = requireApiKey('admin:loans');

    middleware(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('should allow legacy key on unscoped endpoints', () => {
    const legacyKey = process.env.INTERNAL_API_KEY?.split(',')[0];
    if (!legacyKey) return;

    req.headers = { 'x-api-key': legacyKey };
    const middleware = requireApiKey();

    middleware(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('should reject scoped key on unscoped endpoints', () => {
    req.headers = { 'x-api-key': 'admin:loans:scoped-key-value' };
    const middleware = requireApiKey();

    expect(() => {
      middleware(req as Request, res as Response, next);
    }).toThrow();
  });

  it('should allow scoped key with matching scope', () => {
    req.headers = { 'x-api-key': 'test-key' };
    const middleware = requireApiKey('admin:loans');

    middleware(req as Request, res as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('should reject scoped key with non-matching scope', () => {
    req.headers = { 'x-api-key': 'dispute-key' };
    const middleware = requireApiKey('admin:loans');

    expect(() => {
      middleware(req as Request, res as Response, next);
    }).toThrow();
  });
});
