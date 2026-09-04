/**
 * E2E Test Utilities Index
 * Central export for all test utilities, fixtures, and page objects
 */

// Fixtures
export {
  TEST_USERS,
  MOCK_CREDIT_SCORES,
  MOCK_POOL_STATS,
  MOCK_LOAN_CONFIG,
  createMockLoan,
  createMockRemittance,
  createWalletState,
  TestDatabaseSeeder,
  type TestUser,
  type TestLoan,
  type TestRemittance,
} from './fixtures.js';

// Page Objects
export { BasePage } from './page-objects/BasePage.js';
export { WalletPage } from './page-objects/WalletPage.js';
export { KycPage } from './page-objects/KycPage.js';
export { LoanPage } from './page-objects/LoanPage.js';
export { RemittancePage } from './page-objects/RemittancePage.js';
export { DisputePage } from './page-objects/DisputePage.js';
export { AgentPage } from './page-objects/AgentPage.js';
export { SettlementPage } from './page-objects/SettlementPage.js';

/**
 * Common test helpers
 */

/**
 * Wait for API call to complete
 */
export async function waitForApiCall(
  page: any,
  urlPattern: string | RegExp,
  timeout = 10000,
): Promise<any> {
  const response = await page.waitForResponse(urlPattern, { timeout });
  return response.json();
}

/**
 * Mock successful API response
 */
export async function mockSuccessResponse(route: any, data: any): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data,
    }),
  });
}

/**
 * Mock error API response
 */
export async function mockErrorResponse(
  route: any,
  error: string,
  statusCode = 400,
): Promise<void> {
  await route.fulfill({
    status: statusCode,
    contentType: 'application/json',
    body: JSON.stringify({
      success: false,
      error,
    }),
  });
}

/**
 * Setup common route mocks for authenticated user
 */
export async function setupAuthenticatedUser(page: any, user: any): Promise<void> {
  // Setup wallet state
  const walletState = createWalletState(user);
  await page.addInitScript((stateJson: string) => {
    window.localStorage.setItem('dukapay-wallet', stateJson);
  }, JSON.stringify(walletState));

  // Mock user profile
  await page.route('**/api/user/profile', async (route: any) => {
    await mockSuccessResponse(route, {
      id: user.id || 'test_user',
      email: user.email,
      walletAddress: user.publicKey,
      kycVerified: user.kycVerified,
      role: user.role,
    });
  });
}

/**
 * Take screenshot with timestamp
 */
export async function takeTimestampedScreenshot(page: any, name: string): Promise<void> {
  const timestamp = Date.now();
  await page.screenshot({
    path: `screenshots/${name}-${timestamp}.png`,
    fullPage: true,
  });
}

/**
 * Wait for element with custom error message
 */
export async function waitForElement(
  page: any,
  selector: string,
  options: { timeout?: number; errorMessage?: string } = {},
): Promise<void> {
  const { timeout = 10000, errorMessage } = options;
  try {
    await page.waitForSelector(selector, { timeout });
  } catch (error) {
    const message = errorMessage || `Element "${selector}" not found within ${timeout}ms`;
    throw new Error(message);
  }
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; delay?: number } = {},
): Promise<T> {
  const { maxAttempts = 3, delay = 1000 } = options;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delay * attempt));
      }
    }
  }

  throw lastError;
}
