/**
 * E2E Test: Loan Application → Approval → Funding Flow
 * Tests complete loan lifecycle from application through funding
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import {
  TEST_USERS,
  createWalletState,
  createMockLoan,
  MOCK_CREDIT_SCORES,
  MOCK_LOAN_CONFIG,
} from '../utils/fixtures.js';
import { LoanPage } from '../utils/page-objects/LoanPage.js';
import { WalletPage } from '../utils/page-objects/WalletPage.js';

test.describe('Loan Application → Approval → Funding', () => {
  let loanPage: LoanPage;
  let walletPage: WalletPage;

  test.beforeEach(async ({ page }: { page: Page }) => {
    loanPage = new LoanPage(page);
    walletPage = new WalletPage(page);

    // Mock borrower wallet
    const walletState = createWalletState(TEST_USERS.borrower);
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

    // Mock credit score
    await page.route('**/api/score/*', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          score: MOCK_CREDIT_SCORES.good,
          breakdown: {
            paymentHistory: 250,
            creditUtilization: 200,
            accountAge: 150,
            remittanceActivity: 115,
          },
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
          data: MOCK_LOAN_CONFIG,
        }),
      });
    });

    // Mock pool stats
    await page.route('**/api/pool/stats', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            totalDeposits: 1000000,
            availableLiquidity: 550000,
            totalOutstanding: 450000,
            utilizationRate: 0.45,
            apy: 0.12,
          },
        }),
      });
    });
  });

  test('Complete loan application flow', async ({ page }) => {
    const mockLoan = createMockLoan({ status: 'pending' });

    // Mock loan creation
    await page.route('**/api/loans', async (route: Route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: mockLoan,
          }),
        });
      }
    });

    await page.goto('/en');

    // Verify credit score is visible
    await expect(page.locator(`text=${MOCK_CREDIT_SCORES.good}`)).toBeVisible({ timeout: 10000 });

    // Apply for loan
    await loanPage.applyForLoan('1000', 'USDC');

    // Verify application submission
    await expect(page.locator('text=/application.*submitted|pending review/i')).toBeVisible();
  });

  test('Loan approval by agent', async ({ page }) => {
    const loanId = 42;
    const mockLoan = createMockLoan({ id: loanId, status: 'pending' });

    // Mock loan detail
    await page.route(`**/api/loans/${loanId}`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: mockLoan,
        }),
      });
    });

    // Switch to agent wallet
    const agentWalletState = createWalletState(TEST_USERS.agent);
    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem('dukapay-wallet', stateJson);
    }, JSON.stringify(agentWalletState));

    // Mock agent profile
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

    // Mock approval endpoint
    await page.route(`**/api/loans/${loanId}/approve`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { ...mockLoan, status: 'approved' },
        }),
      });
    });

    await page.goto(`/en/agent/loans/${loanId}`);

    // Review and approve
    await page.fill('textarea[name="comment"]', 'Approved based on good credit score');
    await page.click('button:has-text("Approve")');
    await page.click('button:has-text("Confirm")');

    // Verify approval
    await expect(page.locator('text=/approved/i')).toBeVisible({ timeout: 10000 });
  });

  test('Loan funding after approval', async ({ page }) => {
    const loanId = 42;
    const mockLoan = createMockLoan({ id: loanId, status: 'approved' });

    await page.route(`**/api/loans/${loanId}`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: mockLoan,
        }),
      });
    });

    // Mock funding transaction
    await page.route(`**/api/loans/${loanId}/fund`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            ...mockLoan,
            status: 'active',
            fundedAt: new Date().toISOString(),
            txHash: 'tx_funding_abc123',
          },
        }),
      });
    });

    await page.goto(`/en/loans/${loanId}`);

    // Verify loan is approved and ready for funding
    await loanPage.verifyLoanStatus('Approved');

    // Trigger funding (may be automatic or manual)
    const fundButton = page.getByRole('button', { name: /fund|disburse/i });
    if (await fundButton.isVisible()) {
      await fundButton.click();
    }

    // Verify funding success
    await loanPage.verifyLoanStatus('Active');
    await expect(page.locator('text=/funded|disbursed/i')).toBeVisible();
  });

  test('Borrower receives funds after approval', async ({ page }) => {
    const loanId = 42;

    // Mock active loan with funded status
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
              }),
            ],
          },
        }),
      });
    });

    // Mock updated wallet balance (after receiving funds)
    const updatedWalletState = createWalletState(TEST_USERS.borrower, [
      { symbol: 'USDC', amount: '6000.00', usdValue: 6000 }, // +1000 from loan
      { symbol: 'XLM', amount: '100.00', usdValue: 12.5 },
    ]);

    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem('dukapay-wallet', stateJson);
    }, JSON.stringify(updatedWalletState));

    await page.goto('/en');

    // Verify loan appears as active
    await expect(page.locator('text=Active')).toBeVisible();
    await expect(page.locator('text=$1,000')).toBeVisible();

    // Verify increased wallet balance
    await expect(page.locator('text=6,000')).toBeVisible();
  });

  test('Loan rejection flow', async ({ page }) => {
    const loanId = 43;
    const mockLoan = createMockLoan({ id: loanId, status: 'pending' });

    await page.route(`**/api/loans/${loanId}`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: mockLoan,
        }),
      });
    });

    // Mock rejection endpoint
    await page.route(`**/api/loans/${loanId}/reject`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { ...mockLoan, status: 'rejected' },
        }),
      });
    });

    // Switch to agent context
    const agentWalletState = createWalletState(TEST_USERS.agent);
    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem('dukapay-wallet', stateJson);
    }, JSON.stringify(agentWalletState));

    await page.goto(`/en/agent/loans/${loanId}`);

    // Reject loan
    await page.click('button:has-text("Reject")');
    await page.fill('textarea[name="rejectionReason"]', 'Insufficient credit history');
    await page.click('button:has-text("Confirm")');

    // Verify rejection
    await expect(page.locator('text=/rejected/i')).toBeVisible();
  });

  test('Loan application with insufficient credit score', async ({ page }) => {
    // Mock low credit score
    await page.route('**/api/score/*', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          score: MOCK_CREDIT_SCORES.poor, // Below minimum
        }),
      });
    });

    await page.goto('/en');

    // Try to apply for loan
    const applyBtn = page.getByRole('button', { name: /apply for loan/i });
    
    if (await applyBtn.isVisible()) {
      await applyBtn.click();
      // Should see warning about insufficient score
      await expect(page.locator('text=/insufficient.*score|minimum.*score/i')).toBeVisible();
    } else {
      // Button should be disabled or not visible
      await expect(page.locator('text=/improve.*score|not eligible/i')).toBeVisible();
    }
  });

  test('View loan event timeline', async ({ page }) => {
    const loanId = 42;

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
                event_type: 'LoanRequested',
                amount: '1000',
                ledger_closed_at: '2026-01-15T10:00:00Z',
                tx_hash: 'tx_request',
              },
              {
                event_id: 2,
                event_type: 'LoanApproved',
                amount: '0',
                ledger_closed_at: '2026-01-20T14:00:00Z',
                tx_hash: 'tx_approve',
              },
              {
                event_id: 3,
                event_type: 'LoanFunded',
                amount: '1000',
                ledger_closed_at: '2026-01-20T14:30:00Z',
                tx_hash: 'tx_fund',
              },
            ],
          },
        }),
      });
    });

    await loanPage.viewLoanDetails(loanId);

    // Verify timeline events
    await loanPage.verifyTimelineEvents(['Loan requested', 'Loan approved', 'Loan funded']);
  });
});
