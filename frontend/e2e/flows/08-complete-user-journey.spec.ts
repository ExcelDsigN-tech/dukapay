/**
 * E2E Test: Complete User Journey
 * Integration test covering entire user lifecycle across multiple flows
 * This test tags flaky scenarios and demonstrates the quarantine process
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import {
  TEST_USERS,
  createWalletState,
  createMockLoan,
  createMockRemittance,
  MOCK_CREDIT_SCORES,
} from '../utils/fixtures.js';
import { WalletPage } from '../utils/page-objects/WalletPage.js';
import { LoanPage } from '../utils/page-objects/LoanPage.js';
import { RemittancePage } from '../utils/page-objects/RemittancePage.js';

test.describe('Complete User Journey', () => {
  test('Full borrower lifecycle: wallet → loan → repayment → remittance', async ({ page }) => {
    const walletPage = new WalletPage(page);
    const loanPage = new LoanPage(page);
    const remittancePage = new RemittancePage(page);
    const loanId = 1;

    // Setup: Mock borrower wallet
    const walletState = createWalletState(TEST_USERS.borrower, [
      { symbol: 'USDC', amount: '2000.00', usdValue: 2000 },
      { symbol: 'XLM', amount: '100.00', usdValue: 12.5 },
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
          id: 'user_journey',
          email: TEST_USERS.borrower.email,
          walletAddress: TEST_USERS.borrower.publicKey,
          kycVerified: true,
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
          score: MOCK_CREDIT_SCORES.good,
        }),
      });
    });

    // Mock loan config
    await page.route('**/api/loans/config', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            minScore: 500,
            maxAmount: 10000,
            interestRatePercent: 8,
          },
        }),
      });
    });

    // Step 1: Connect wallet and verify
    await page.goto('/en');
    await walletPage.verifyConnected(TEST_USERS.borrower.publicKey);
    await expect(page.locator(`text=${MOCK_CREDIT_SCORES.good}`)).toBeVisible({ timeout: 10000 });

    // Step 2: Apply for loan
    await page.route('**/api/loans', async (route: Route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: createMockLoan({ id: loanId, status: 'pending' }),
          }),
        });
      }
    });

    await loanPage.applyForLoan('1000', 'USDC');
    await expect(page.locator('text=/application.*submitted/i')).toBeVisible();

    // Step 3: Simulate loan approval and funding
    await page.route('**/api/loans/borrower/**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            borrower: TEST_USERS.borrower.publicKey,
            loans: [
              createMockLoan({
                id: loanId,
                status: 'active',
                principal: 1000,
                totalOwed: 1080,
                amountPaid: 0,
              }),
            ],
          },
        }),
      });
    });

    await page.reload();
    await loanPage.verifyLoanStatus('Active');
    await expect(page.locator('text=$1,000')).toBeVisible();

    // Step 4: Make partial repayment
    await page.route(`**/api/loans/${loanId}/repay`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            txHash: 'tx_repay_journey',
            newBalance: 580,
            status: 'active',
            amountPaid: 500,
          },
        }),
      });
    });

    await loanPage.makeRepayment('500');
    await expect(page.locator('text=/repayment.*successful/i')).toBeVisible();

    // Step 5: Send remittance with remaining funds
    const mockRemittance = createMockRemittance({
      amount: 200,
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
      }
    });

    await page.route('**/api/rates', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          rates: { 'USDC-NGN': 1650 },
        }),
      });
    });

    await remittancePage.sendRemittance({
      recipientAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
      amount: '200',
      fromCurrency: 'USDC',
      toCurrency: 'NGN',
    });

    await expect(page.locator('text=/sent.*successfully/i')).toBeVisible();

    // Step 6: Verify updated balances and history
    await page.goto('/en');
    await expect(page.locator('text=580')).toBeVisible(); // Remaining loan balance
  });

  test('Agent workflow: review loan → process settlement', async ({ page }) => {
    const loanId = 2;
    const remittanceId = 'rem_agent_flow';

    // Setup agent context
    const agentWalletState = createWalletState(TEST_USERS.agent);
    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem('dukapay-wallet', stateJson);
    }, JSON.stringify(agentWalletState));

    await page.route('**/api/user/profile', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'agent_journey',
          email: TEST_USERS.agent.email,
          walletAddress: TEST_USERS.agent.publicKey,
          kycVerified: true,
          role: 'agent',
        }),
      });
    });

    // Step 1: Review pending loan
    await page.route(`**/api/loans/${loanId}`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: createMockLoan({ id: loanId, status: 'pending' }),
        }),
      });
    });

    await page.goto(`/en/agent/loans/${loanId}`);
    await expect(page.locator('text=/loan.*application/i')).toBeVisible();

    // Step 2: Approve loan
    await page.route(`**/api/loans/${loanId}/approve`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { status: 'approved' },
        }),
      });
    });

    await page.fill('textarea[name="comment"]', 'Approved - good credit history');
    await page.click('button:has-text("Approve")');
    await page.click('button:has-text("Confirm")');
    await expect(page.locator('text=/approved/i')).toBeVisible();

    // Step 3: Process settlement
    await page.route('**/api/settlements*', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            settlements: [
              {
                id: 'settle_agent',
                remittanceId: remittanceId,
                amount: 500,
                status: 'pending',
              },
            ],
          },
        }),
      });
    });

    await page.goto('/en/agent/settlements');
    await expect(page.locator('text=/pending.*settlements/i')).toBeVisible();

    // Process settlement
    await page.route(`**/api/settlements/settle_agent/process`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { status: 'completed' },
        }),
      });
    });

    await page.click('button:has-text("Process")');
    await expect(page.locator('text=/settlement.*successful/i')).toBeVisible();
  });

  // Flaky test demonstration - tagged for quarantine
  test('[@flaky] Cross-browser wallet synchronization', async ({ page, browserName }) => {
    // This test might be flaky due to timing issues in different browsers
    test.skip(browserName !== 'chromium', 'Flaky on non-Chromium browsers');

    const walletState = createWalletState(TEST_USERS.borrower);
    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem('dukapay-wallet', stateJson);
    }, JSON.stringify(walletState));

    await page.goto('/en');

    // Simulate wallet state change
    await page.evaluate(() => {
      const event = new StorageEvent('storage', {
        key: 'dukapay-wallet',
        newValue: JSON.stringify({
          state: {
            status: 'connected',
            balances: [{ symbol: 'USDC', amount: '10000.00' }],
          },
        }),
      });
      window.dispatchEvent(event);
    });

    // This assertion might be flaky
    await expect(page.locator('text=10,000')).toBeVisible({ timeout: 5000 });
  });

  // Another flaky test - network timing dependent
  test('[@flaky] Real-time notification updates', async ({ page }) => {
    const walletState = createWalletState(TEST_USERS.borrower);
    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem('dukapay-wallet', stateJson);
    }, JSON.stringify(walletState));

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

    await page.goto('/en');

    // Mock SSE connection for notifications
    // This can be flaky due to timing and network conditions
    await page.route('**/api/notifications/stream', async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: 'data: {"type":"loan_approved","message":"Your loan has been approved"}\n\n',
      });
    });

    // Flaky assertion - timing dependent
    await expect(page.locator('text=/loan.*approved/i')).toBeVisible({ timeout: 3000 });
  });

  test('Multi-step transaction flow with rollback', async ({ page }) => {
    const walletState = createWalletState(TEST_USERS.borrower);
    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem('dukapay-wallet', stateJson);
    }, JSON.stringify(walletState));

    await page.route('**/api/user/profile', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'user_1',
          walletAddress: TEST_USERS.borrower.publicKey,
          kycVerified: true,
        }),
      });
    });

    await page.goto('/en');

    // Simulate transaction failure and rollback
    await page.route('**/api/loans', async (route: Route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: 'Transaction failed',
        }),
      });
    });

    const loanPage = new LoanPage(page);
    
    // Try to apply for loan
    await page.click('button:has-text("Apply for Loan")');
    await page.selectOption('select[name="asset"]', 'USDC');
    await page.fill('input[placeholder="0.00"]', '1000');
    await page.click('button:has-text("Continue")');
    await page.click('input[type="checkbox"]');
    await page.click('button:has-text("Continue")');
    await page.click('button:has-text("Submit")');

    // Verify error handling and rollback
    await expect(page.locator('text=/transaction.*failed|error.*occurred/i')).toBeVisible();
    
    // Verify state wasn't changed
    await page.goto('/en');
    await expect(page.locator('text=Active')).not.toBeVisible(); // No active loans
  });
});
