/**
 * E2E Test: Agent Onboarding & KYC Flow
 * Tests complete agent registration and KYC verification process
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { TEST_USERS, createWalletState, MOCK_CREDIT_SCORES } from '../utils/fixtures.js';
import { WalletPage } from '../utils/page-objects/WalletPage.js';
import { KycPage } from '../utils/page-objects/KycPage.js';

test.describe('Agent Onboarding & KYC', () => {
  let walletPage: WalletPage;
  let kycPage: KycPage;

  test.beforeEach(async ({ page }: { page: Page }) => {
    walletPage = new WalletPage(page);
    kycPage = new KycPage(page);

    // Mock unverified agent wallet connection
    const walletState = createWalletState(TEST_USERS.agent);
    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem('dukapay-wallet', stateJson);
    }, JSON.stringify(walletState));

    // Mock user profile (unverified)
    await page.route('**/api/user/profile', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'agent_1',
          email: TEST_USERS.agent.email,
          walletAddress: TEST_USERS.agent.publicKey,
          kycVerified: false,
          role: 'agent',
        }),
      });
    });

    // Mock credit score
    await page.route('**/api/score/*', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          score: MOCK_CREDIT_SCORES.minimal,
        }),
      });
    });
  });

  test('Complete agent onboarding flow with KYC submission', async ({ page }) => {
    // Step 1: Verify wallet connection
    await page.goto('/en');
    await walletPage.verifyConnected(TEST_USERS.agent.publicKey);

    // Step 2: Navigate to KYC page (should be prompted)
    await expect(page.locator('text=/complete.*kyc|verify.*identity/i')).toBeVisible();
    await page.click('a[href*="kyc"]');

    // Step 3: Fill KYC form
    await kycPage.fillPersonalInfo({
      firstName: 'Jane',
      lastName: 'Agent',
      dateOfBirth: '1990-05-15',
      countryCode: 'KE',
    });

    // Mock KYC submission
    await page.route('**/api/auth/kyc', async (route: Route) => {
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            status: 'pending',
            providerReference: 'kyc_ref_123',
          },
        }),
      });
    });

    // Step 4: Accept terms and submit
    await kycPage.acceptTerms();
    await kycPage.submitKyc();

    // Step 5: Verify submission confirmation
    await expect(page.locator('text=/submitted|pending review/i')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=/review.*24.*hours|processing/i')).toBeVisible();
  });

  test('KYC approval flow', async ({ page }) => {
    await page.goto('/en/kyc');

    // Mock KYC approval
    await page.route('**/api/auth/kyc', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            status: 'approved',
            providerReference: 'kyc_ref_approved',
          },
        }),
      });
    });

    await kycPage.fillPersonalInfo({
      firstName: 'Jane',
      lastName: 'Agent',
      dateOfBirth: '1990-05-15',
      countryCode: 'KE',
    });

    await kycPage.acceptTerms();
    await kycPage.submitKyc();

    // Verify immediate approval
    await expect(page.locator('text=/approved|verified/i')).toBeVisible({ timeout: 10000 });
  });

  test('KYC rejection handling', async ({ page }) => {
    await page.goto('/en/kyc');

    // Mock KYC rejection
    await page.route('**/api/auth/kyc', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            status: 'rejected',
            providerReference: 'kyc_ref_rejected',
            reason: 'Document verification failed',
          },
        }),
      });
    });

    await kycPage.fillPersonalInfo({
      firstName: 'Invalid',
      lastName: 'User',
      dateOfBirth: '2010-01-01',
      countryCode: 'XX',
    });

    await kycPage.acceptTerms();
    await kycPage.submitKyc();

    // Verify rejection message
    await expect(page.locator('text=/rejected|not approved/i')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=/resubmit|contact support/i')).toBeVisible();
  });

  test('KYC form validation', async ({ page }) => {
    await page.goto('/en/kyc');

    // Try to submit without filling required fields
    await kycPage.submitKyc();

    // Verify validation errors
    await expect(page.locator('text=/required|must provide/i')).toBeVisible();
  });

  test('Agent dashboard access after KYC approval', async ({ page }) => {
    // Update profile to verified
    await page.route('**/api/user/profile', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'agent_1',
          email: TEST_USERS.agent.email,
          walletAddress: TEST_USERS.agent.publicKey,
          kycVerified: true,
          role: 'agent',
        }),
      });
    });

    await page.goto('/en');

    // Verify access to agent dashboard
    await expect(page.locator('a[href*="agent"]')).toBeVisible();
    await page.click('a[href*="agent"]');
    await expect(page.locator('text=/agent dashboard|my agent account/i')).toBeVisible();
  });
});
