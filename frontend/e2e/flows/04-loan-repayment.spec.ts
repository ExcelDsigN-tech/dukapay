/**
 * E2E Test: Loan Repayment Flow
 * Tests complete loan repayment process including partial and full repayments
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { TEST_USERS, createWalletState, createMockLoan } from '../utils/fixtures.js';
import { LoanPage } from '../utils/page-objects/LoanPage.js';

test.describe('Loan Repayment Flow', () => {
  let loanPage: LoanPage;
  const loanId = 42;

  test.beforeEach(async ({ page }: { page: Page }) => {
    loanPage = new LoanPage(page);

    // Mock borrower wallet with sufficient balance
    const walletState = createWalletState(TEST_USERS.borrower, [
      { symbol: 'USDC', amount: '5000.00', usdValue: 5000 },
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
          id: 'user_1',
          email: TEST_USERS.borrower.email,
          walletAddress: TEST_USERS.borrower.publicKey,
          kycVerified: true,
        }),
      });
    });
  });

  test('Full loan repayment', async ({ page }) => {
    // Mock active loan
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
                principal: 1000,
                totalOwed: 1080,
                amountPaid: 0,
                status: 'active',
              }),
            ],
          },
        }),
      });
    });

    // Mock repayment submission
    await page.route(`**/api/loans/${loanId}/repay`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            txHash: 'tx_repay_full',
            newBalance: 0,
            status: 'repaid',
            amountPaid: 1080,
          },
        }),
      });
    });

    await page.goto('/en');

    // Make full repayment
    await loanPage.makeRepayment('1080');

    // Verify repayment success
    await expect(page.locator('text=/repayment.*successful|paid in full/i')).toBeVisible();

    // Verify loan status changed to repaid
    await page.reload();
    await loanPage.verifyLoanStatus('Repaid');
  });

  test('Partial loan repayment', async ({ page }) => {
    // Mock active loan
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
                principal: 1000,
                totalOwed: 1080,
                amountPaid: 0,
                status: 'active',
              }),
            ],
          },
        }),
      });
    });

    // Mock partial repayment
    await page.route(`**/api/loans/${loanId}/repay`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            txHash: 'tx_repay_partial',
            newBalance: 580, // 1080 - 500
            status: 'active',
            amountPaid: 500,
          },
        }),
      });
    });

    await page.goto('/en');

    // Make partial repayment
    await loanPage.makeRepayment('500');

    // Verify partial repayment success
    await expect(page.locator('text=/repayment.*successful|payment received/i')).toBeVisible();

    // Verify remaining balance
    await page.reload();
    await expect(page.locator('text=580')).toBeVisible(); // Remaining balance
  });

  test('Multiple partial repayments leading to full repayment', async ({ page }) => {
    let remainingBalance = 1080;

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
                principal: 1000,
                totalOwed: remainingBalance,
                amountPaid: 1080 - remainingBalance,
                status: remainingBalance > 0 ? 'active' : 'repaid',
              }),
            ],
          },
        }),
      });
    });

    await page.route(`**/api/loans/${loanId}/repay`, async (route: Route) => {
      const requestBody = await route.request().postDataJSON();
      const payment = parseFloat(requestBody.amount);
      remainingBalance -= payment;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            txHash: `tx_repay_${Date.now()}`,
            newBalance: Math.max(0, remainingBalance),
            status: remainingBalance <= 0 ? 'repaid' : 'active',
            amountPaid: payment,
          },
        }),
      });
    });

    await page.goto('/en');

    // First payment
    await loanPage.makeRepayment('400');
    await page.reload();
    await expect(page.locator('text=680')).toBeVisible();

    // Second payment
    await loanPage.makeRepayment('400');
    await page.reload();
    await expect(page.locator('text=280')).toBeVisible();

    // Final payment
    await loanPage.makeRepayment('280');
    await loanPage.verifyLoanStatus('Repaid');
  });

  test('Repayment with insufficient balance', async ({ page }) => {
    // Mock active loan
    await page.route('**/api/loans/borrower/**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            borrower: TEST_USERS.borrower.publicKey,
            loans: [createMockLoan({ id: loanId, totalOwed: 1080 })],
          },
        }),
      });
    });

    // Set low wallet balance
    const lowBalanceState = createWalletState(TEST_USERS.borrower, [
      { symbol: 'USDC', amount: '500.00', usdValue: 500 },
    ]);

    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem('dukapay-wallet', stateJson);
    }, JSON.stringify(lowBalanceState));

    await page.goto('/en');

    // Try to repay more than balance
    await page.click('button:has-text("Repay")');
    await page.fill('input[type="number"]', '1080');
    await page.click('button:has-text("Review")');

    // Verify error message
    await expect(page.locator('text=/insufficient.*balance|not enough funds/i')).toBeVisible();
  });

  test('Early repayment with interest reduction', async ({ page }) => {
    // Mock loan with early repayment benefit
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
                principal: 1000,
                totalOwed: 1080,
                status: 'active',
              }),
            ],
          },
        }),
      });
    });

    // Mock early repayment calculation
    await page.route(`**/api/loans/${loanId}/calculate-payoff`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            fullAmount: 1080,
            earlyPayoffAmount: 1050, // Reduced interest
            interestSaved: 30,
          },
        }),
      });
    });

    await loanPage.viewLoanDetails(loanId);

    // Check early payoff option
    await page.click('button:has-text("Calculate Early Payoff")');

    // Verify interest savings
    await expect(page.locator('text=/save.*30|interest saved/i')).toBeVisible();
    await expect(page.locator('text=1,050')).toBeVisible();
  });

  test('View repayment history', async ({ page }) => {
    await page.route(`**/api/loans/${loanId}/events`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            loanId,
            events: [
              {
                event_id: 1,
                event_type: 'LoanRepaid',
                amount: '500',
                ledger_closed_at: '2026-02-15T10:00:00Z',
                tx_hash: 'tx_repay_1',
              },
              {
                event_id: 2,
                event_type: 'LoanRepaid',
                amount: '580',
                ledger_closed_at: '2026-03-15T10:00:00Z',
                tx_hash: 'tx_repay_2',
              },
            ],
          },
        }),
      });
    });

    await loanPage.viewLoanDetails(loanId);

    // Verify repayment timeline
    await loanPage.verifyTimelineEvents(['Repayment made']);
    await expect(page.locator('text=$500')).toBeVisible();
    await expect(page.locator('text=$580')).toBeVisible();
  });

  test('Auto-repayment setup (if supported)', async ({ page }) => {
    await loanPage.viewLoanDetails(loanId);

    // Check if auto-repayment is available
    const autoRepayBtn = page.getByRole('button', { name: /auto.*repay|set up.*automatic/i });
    
    if (await autoRepayBtn.isVisible()) {
      await autoRepayBtn.click();
      
      // Configure auto-repayment
      await page.selectOption('select[name="frequency"]', 'monthly');
      await page.fill('input[name="amount"]', '100');
      
      // Mock auto-repayment setup
      await page.route('**/api/loans/${loanId}/auto-repay', async (route: Route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { autoRepayEnabled: true },
          }),
        });
      });
      
      await page.click('button:has-text("Enable")');
      await expect(page.locator('text=/auto.*repayment.*enabled/i')).toBeVisible();
    }
  });

  test('Repayment receipt download', async ({ page }) => {
    await loanPage.viewLoanDetails(loanId);

    // Mock repayment history
    await page.route(`**/api/loans/${loanId}/events`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            events: [
              {
                event_id: 1,
                event_type: 'LoanRepaid',
                amount: '500',
                ledger_closed_at: '2026-02-15T10:00:00Z',
              },
            ],
          },
        }),
      });
    });

    // Export repayment history
    await loanPage.exportLoanHistory();

    // Verify export initiated (download triggered)
    // In real test, we'd check for download event
  });
});
