import {
  ErrorCode,
  ERROR_CODE_REGISTRY,
  getErrorCodeMetadata,
  getDefaultErrorCodeForStatus,
} from '../errors/errorCodes.js';
import { AppError } from '../errors/AppError.js';

describe('ERROR_CODE_REGISTRY', () => {
  it('provides metadata for every enum member', () => {
    const enumKeys = Object.keys(ErrorCode).filter((k) => isNaN(Number(k)));
    for (const key of enumKeys) {
      const metadata = ERROR_CODE_REGISTRY[key as ErrorCode];
      expect(metadata).toBeDefined();
      expect(metadata.code).toBe(key);
      expect(metadata.message).toBeTruthy();
      expect(metadata.httpStatus).toBeGreaterThanOrEqual(400);
      expect(metadata.description).toBeTruthy();
    }
  });

  it('includes SERVICE_UNAVAILABLE with a 503 status', () => {
    const metadata = ERROR_CODE_REGISTRY[ErrorCode.SERVICE_UNAVAILABLE];
    expect(metadata.httpStatus).toBe(503);
    expect(metadata.message).toMatch(/unavailable/i);
  });

  it('maps all codes to a 4xx or 5xx status', () => {
    const enumKeys = Object.keys(ErrorCode).filter((k) => isNaN(Number(k)));
    for (const key of enumKeys) {
      const status = ERROR_CODE_REGISTRY[key as ErrorCode].httpStatus;
      expect(status >= 400 && status < 600).toBe(true);
    }
  });
});

describe('getErrorCodeMetadata', () => {
  it('returns metadata for a known code', () => {
    const metadata = getErrorCodeMetadata(ErrorCode.INVALID_AMOUNT);
    expect(metadata.message).toBe('Amount must be a positive number');
    expect(metadata.httpStatus).toBe(400);
  });
});

describe('getDefaultErrorCodeForStatus', () => {
  it.each([
    [400, ErrorCode.VALIDATION_ERROR],
    [401, ErrorCode.UNAUTHORIZED],
    [403, ErrorCode.FORBIDDEN],
    [404, ErrorCode.NOT_FOUND],
    [409, ErrorCode.CONFLICT],
    [429, ErrorCode.RATE_LIMIT_EXCEEDED],
    [503, ErrorCode.SERVICE_UNAVAILABLE],
    [500, ErrorCode.INTERNAL_ERROR],
  ])('maps HTTP %i to %s', (status, expected) => {
    expect(getDefaultErrorCodeForStatus(status)).toBe(expected);
  });

  it('falls back to INTERNAL_ERROR for unknown statuses', () => {
    expect(getDefaultErrorCodeForStatus(418)).toBe(ErrorCode.INTERNAL_ERROR);
  });
});

describe('AppError', () => {
  it('classifies 4xx errors as fail and 5xx errors as error', () => {
    const badRequest = AppError.badRequest();
    const internal = AppError.internal();

    expect(badRequest.status).toBe('fail');
    expect(internal.status).toBe('error');
  });

  it('derives a default error code from the status code', () => {
    const notFound = AppError.notFound();
    expect(notFound.errorCode).toBe(ErrorCode.NOT_FOUND);
  });

  it('uses the provided error code when supplied', () => {
    const error = AppError.withCode(ErrorCode.INSUFFICIENT_BALANCE);
    expect(error.errorCode).toBe(ErrorCode.INSUFFICIENT_BALANCE);
    expect(error.statusCode).toBe(400);
  });

  it('constructs serviceUnavailable errors with SERVICE_UNAVAILABLE code', () => {
    const error = AppError.serviceUnavailable();
    expect(error.errorCode).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    expect(error.statusCode).toBe(503);
    expect(error.isOperational).toBe(true);
  });

  it('captures a stack trace', () => {
    const error = AppError.internal();
    expect(error.stack).toBeTruthy();
  });
});