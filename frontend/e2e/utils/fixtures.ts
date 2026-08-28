/**
 * Test Fixtures and Database Seeding Utilities
 * Provides test data setup/teardown with database seeding
 */

export interface TestUser {
  publicKey: string;
  email: string;
  kycVerified: boolean;
  role?: 'borrower' | 'lender' | 'agent' | 'admin';
}

export interface TestLoan {
  id: number;
  principal: number;
  asset: string;
  status: 'pending' | 'active' | 'repaid' | 'defaulted';
  borrower: string;
  totalOwed: number;
  amountPaid?: number;
  interestRateBps: number;
  termLedgers: number;
}

export interface TestRemittance {
  id: string;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  status: 'pending' | 'completed' | 'failed';
  recipientAddress: string;
  sender: string;
}

/**
 * Mock wallet addresses for different user roles
 */
export const TEST_USERS = {
  borrower: {
    publicKey: 'GCJPBXSE6WCQDCEYZW6C3YVZCSSCHC4AE72L5KWKCYL2CLLL7NH5VSCI',
    email: 'borrower@test.dukapay.com',
    kycVerified: true,
    role: 'borrower' as const,
  },
  lender: {
    publicKey: 'GDLENDERXAMPLEKEY123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    email: 'lender@test.dukapay.com',
    kycVerified: true,
    role: 'lender' as const,
  },
  agent: {
    publicKey: 'GDAGENTXAMPLEKEY123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1',
    email: 'agent@test.dukapay.com',
    kycVerified: false,
    role: 'agent' as const,
  },
  admin: {
    publicKey: 'GDADMINXAMPLEKEY123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ2',
    email: 'admin@test.dukapay.com',
    kycVerified: true,
    role: 'admin' as const,
  },
  unverified: {
    publicKey: 'GDUNVERXAMPLEKEY123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    email: 'unverified@test.dukapay.com',
    kycVerified: false,
    role: 'borrower' as const,
  },
} as const;

/**
 * Sample loan data for testing
 */
export const createMockLoan = (overrides?: Partial<TestLoan>): TestLoan => ({
  id: 1,
  principal: 1000,
  asset: 'USDC',
  status: 'active',
  borrower: TEST_USERS.borrower.publicKey,
  totalOwed: 1080,
  amountPaid: 0,
  interestRateBps: 800,
  termLedgers: 365,
  ...overrides,
});

/**
 * Sample remittance data for testing
 */
export const createMockRemittance = (overrides?: Partial<TestRemittance>): TestRemittance => ({
  id: `rem_${Date.now()}`,
  amount: 250,
  fromCurrency: 'USDC',
  toCurrency: 'NGN',
  status: 'completed',
  recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  sender: TEST_USERS.borrower.publicKey,
  ...overrides,
});

/**
 * Create wallet state for localStorage injection
 */
export const createWalletState = (user: TestUser, balances?: any[]) => ({
  state: {
    status: 'connected',
    address: user.publicKey,
    network: { chainId: 2, name: 'TESTNET', isSupported: true },
    balances: balances || [
      { symbol: 'USDC', amount: '5000.00', usdValue: 5000 },
      { symbol: 'XLM', amount: '100.00', usdValue: 12.5 },
    ],
    shouldAutoReconnect: true,
  },
  version: 0,
});

/**
 * Database seeding utility (for backend integration tests)
 * In real implementation, this would connect to test database
 */
export class TestDatabaseSeeder {
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:4000') {
    this.baseUrl = baseUrl;
  }

  async seedUser(user: TestUser): Promise<void> {
    // In production, this would insert into the database
    // For now, we rely on API mocks in tests
    console.log(`[TEST] Seeding user: ${user.email}`);
  }

  async seedLoan(loan: TestLoan): Promise<void> {
    console.log(`[TEST] Seeding loan: ${loan.id}`);
  }

  async seedRemittance(remittance: TestRemittance): Promise<void> {
    console.log(`[TEST] Seeding remittance: ${remittance.id}`);
  }

  async cleanup(): Promise<void> {
    console.log('[TEST] Cleaning up test data');
  }
}

/**
 * Credit score fixtures
 */
export const MOCK_CREDIT_SCORES = {
  excellent: 800,
  good: 715,
  fair: 620,
  poor: 550,
  minimal: 300,
};

/**
 * Pool stats fixtures
 */
export const MOCK_POOL_STATS = {
  totalDeposits: 1000000,
  totalOutstanding: 450000,
  utilizationRate: 0.45,
  apy: 0.12,
  activeLoansCount: 154,
};

/**
 * Loan config fixtures
 */
export const MOCK_LOAN_CONFIG = {
  minScore: 500,
  maxAmount: 10000,
  interestRatePercent: 8,
  minAmount: 100,
  maxTermDays: 365,
};
