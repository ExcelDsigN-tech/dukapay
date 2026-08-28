/**
 * E2E Test: Cash-in/Cash-out (Remittance) Flow
 * Tests complete remittance sending and receiving process
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { TEST_USERS, createWalletState, createMockRemittance } from '../utils/fixtures.js';
import { WalletPage } from '../utils/page-objects/WalletPage.js';
import { RemittancePage } from '../utils/page-objects/RemittancePage.js';

test.describe('Cash-in/Cash-out Flow', () => {
  let walletPage: WalletPage;
  let remittancePage: RemittancePage;

  test.beforeEach(async ({ page }: { page: Page }) => {
    walletPage = new WalletPage(page);
    remittancePage = new RemittancePage(page);

    // Mock verified borrower wallet
    const walletState = createWalletState(TEST_USERS.borrower, [
      { symbol: 'USDC', amount: '10000.00', usdValue: 10000 },
      { symbol: 'XLM', amount: '500.00', usdValue: 62.5 },
    ]);
    
    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem('dukapay-wallet', stateJson);
    }, JSON.stringify(walletState));

    // Mock user profile
    await page.route('**/api/user/profile', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'user_1',
          email: TEST_USERS.borrower.email,
          walletAddress: TEST_USERS.borrower.publicKey,
          kycVerified: true,
        }),
      });
    });

    // Mock exchange rates
    await page.route('**/api/rates', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          rates: {
            'USDC-NGN': 1650,
            'USDC-KES': 150,
            'USDC-GHS': 15.5,
          },
        }),
      });
    });
  });

  test('Complete cash-out (send remittance) flow', async ({ page }) => {
    // Mock remittance creation
    const mockRemittance = createMockRemittance({
      amount: 500,
      fromCurrency: 'USDC',
      toCurrency: 'NGN',
    });

    await page.route('**/api/remittances', async (route: Route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: mockRemittance,
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/en');

    // Send remittance
    await remittancePage.sendRemittance({
      recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      amount: '500',
      fromCurrency: 'USDC',
      toCurrency: 'NGN',
    });

    // Verify success message
    await expect(page.locator('text=/sent.*successfully|remittance.*complete/i')).toBeVisible();

    // Verify transaction hash or confirmation
    await expect(page.locator('[data-testid="tx-hash"]')).toBeVisible();
  });

  test('View remittance history', async ({ page }) => {
    // Mock remittance history
    const remittances = [
      createMockRemittance({ amount: 500, status: 'completed' }),
      createMockRemittance({ amount: 250, status: 'pending' }),
      createMockRemittance({ amount: 1000, status: 'completed' }),
    ];

    await page.route('**/api/remittances', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: remittances,
        }),
      });
    });

    await remittancePage.navigateToHistory();

    // Verify history is displayed
    await expect(page.locator('text=/history|past remittances/i')).toBeVisible();
    await expect(page.locator('text=$500')).toBeVisible();
    await expect(page.locator('text=$250')).toBeVisible();
    await expect(page.locator('text=$1,000')).toBeVisible();

    // Verify status indicators
    await expect(page.locator('text=Completed')).toHaveCount(2);
    await expect(page.locator('text=Pending')).toBeVisible();
  });

  test('Exchange rate calculation', async ({ page }) => {
    await page.goto('/en/remittances/send');

    // Fill amount
    await page.fill('input[name="amount"]', '100');
    await page.selectOption('select[name="fromCurrency"]', 'USDC');
    await page.selectOption('select[name="toCurrency"]', 'NGN');

    // Verify exchange rate is displayed
    await expect(page.locator('[data-testid="exchange-rate"]')).toContainText('1,650');

    // Verify converted amount
    await expect(page.locator('[data-testid="converted-amount"]')).toContainText('165,000');
  });

  test('Remittance with insufficient balance', async ({ page }) => {
    await page.goto('/en/remittances/send');

    // Try to send more than balance
    await page.fill('input[name="recipientAddress"]', '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb');
    await page.fill('input[name="amount"]', '20000'); // More than 10000 balance
    await page.selectOption('select[name="fromCurrency"]', 'USDC');

    await page.click('button:has-text("Review")');

    // Verify error message
    await expect(page.locator('text=/insufficient.*balance|not enough/i')).toBeVisible();
  });

  test('View remittance NFT certificate', async ({ page }) => {
    const remittanceId = 'rem_12345';

    // Mock remittance detail
    await page.route(`**/api/remittances/${remittanceId}`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            ...createMockRemittance({ id: remittanceId }),
            nftMinted: true,
            nftTokenId: 'token_123',
            certificateUrl: 'https://ipfs.io/ipfs/Qm...',
          },
        }),
      });
    });

    await remittancePage.viewRemittanceNFT(remittanceId);

    // Verify NFT details
    await expect(page.locator('text=/nft.*certificate|proof.*remittance/i')).toBeVisible();
    await expect(page.locator('[data-testid="nft-token-id"]')).toContainText('token_123');
  });

  test('Filter remittances by status', async ({ page }) => {
    // Mock filtered remittances
    await page.route('**/api/remittances?status=completed', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [createMockRemittance({ status: 'completed' })],
        }),
      });
    });

    await remittancePage.navigateToHistory();
    await remittancePage.filterByStatus('completed');

    // Verify only completed remittances shown
    await expect(page.locator('text=Completed')).toBeVisible();
    await expect(page.locator('text=Pending')).not.toBeVisible();
  });

  test('Cancel pending remittance', async ({ page }) => {
    const remittanceId = 'rem_pending';

    await page.route(`**/api/remittances/${remittanceId}/cancel`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { status: 'cancelled' },
        }),
      });
    });

    await page.goto(`/en/remittances/${remittanceId}`);
    await page.click('button:has-text("Cancel")');
    await page.click('button:has-text("Confirm")');

    await expect(page.locator('text=/cancelled|refunded/i')).toBeVisible();
  });
});
