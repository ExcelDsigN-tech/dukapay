import { validateEnvVars } from '../config/env.js';
import { jest } from '@jest/globals';

jest.mock('../utils/logger.js');

describe('Environment Variable Validation', () => {
  const originalEnv = process.env;
  let mockExit: ReturnType<typeof jest.spyOn>;

  beforeAll(() => {
    mockExit = jest
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`Process.exit called with ${code}`);
      });
  });

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
    mockExit.mockRestore();
  });

  function setValidBaseEnv(): void {
    process.env.DATABASE_URL = 'postgres://localhost';
    process.env.REDIS_URL = 'redis://localhost';
    process.env.JWT_SECRET = 'secret';
    process.env.STELLAR_RPC_URL = 'http://localhost';
    process.env.STELLAR_NETWORK_PASSPHRASE = 'test';
    process.env.LOAN_MANAGER_CONTRACT_ID = 'C1';
    process.env.LENDING_POOL_CONTRACT_ID = 'C2';
    process.env.POOL_TOKEN_ADDRESS = 'T1';
    process.env.LOAN_MANAGER_ADMIN_SECRET = 'S1';
    process.env.INTERNAL_API_KEY = 'K1';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.SCORE_DELTA_REPAY = '15';
    process.env.SCORE_DELTA_DEFAULT = '50';
    process.env.SCORE_DELTA_LATE = '5';
    process.env.REMITTANCE_NFT_CONTRACT_ID = 'C3';
    process.env.MULTISIG_GOVERNANCE_CONTRACT_ID = 'C4';
  }

  it('should not exit if all required variables are present', () => {
    // All required variables are expected to be in originalEnv/process.env
    // or we set them here for the test
    setValidBaseEnv();

    expect(() => validateEnvVars()).not.toThrow();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should exit with code 1 if a required variable is missing', () => {
    delete process.env.DATABASE_URL;

    expect(() => validateEnvVars()).toThrow('Process.exit called with 1');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with code 1 if a required variable is empty string', () => {
    process.env.DATABASE_URL = '   ';

    expect(() => validateEnvVars()).toThrow('Process.exit called with 1');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit in production when KYC is not enabled (hard requirement)', () => {
    process.env.NODE_ENV = 'production';
    setValidBaseEnv();
    delete process.env.KYC_ENFORCEMENT_ENABLED;
    delete process.env.AUDIT_ANCHOR_ENABLED;

    expect(() => validateEnvVars()).toThrow('Process.exit called with 1');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should warn but not exit in production when KYC is on and audit anchoring is off', () => {
    process.env.NODE_ENV = 'production';
    setValidBaseEnv();
    process.env.KYC_ENFORCEMENT_ENABLED = 'true';
    delete process.env.AUDIT_ANCHOR_ENABLED;

    expect(() => validateEnvVars()).not.toThrow();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should exit in production when audit anchoring is on but anchor config is missing', () => {
    process.env.NODE_ENV = 'production';
    setValidBaseEnv();
    process.env.KYC_ENFORCEMENT_ENABLED = 'true';
    process.env.AUDIT_ANCHOR_ENABLED = 'true';
    delete process.env.AUDIT_ANCHOR_CONTRACT_ID;
    delete process.env.AUDIT_ANCHOR_SOURCE_SECRET;

    expect(() => validateEnvVars()).toThrow('Process.exit called with 1');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should not exit in production when KYC is on and audit anchoring is fully configured', () => {
    process.env.NODE_ENV = 'production';
    setValidBaseEnv();
    process.env.KYC_ENFORCEMENT_ENABLED = 'true';
    process.env.AUDIT_ANCHOR_ENABLED = 'true';
    process.env.AUDIT_ANCHOR_CONTRACT_ID = 'C_ANCHOR';
    process.env.AUDIT_ANCHOR_SOURCE_SECRET = 'S_ANCHOR';

    expect(() => validateEnvVars()).not.toThrow();
    expect(mockExit).not.toHaveBeenCalled();
  });
});
