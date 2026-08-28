/**
 * E2E Test: Agent Float Transfer Flow
 * Tests agent liquidity management and float transfers
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { TEST_USERS, createWalletState } from '../utils/fixtures.js';
import { AgentPage } from '../utils/page-objects/AgentPage.js';

test.describe('Agent Float Transfer Flow', () => {
  let agentPage: AgentPage;

  test.beforeEach(async ({ page }: { page: Page }) => {
    agentPage = new AgentPage(page);

    // Mock agent wallet with float balance
    const walletState = createWalletState(TEST_USERS.agent, [
      { symbol: 'USDC', amount: '50000.00', usdValue: 50000 },
      { symbol: 'XLM', amount: '1000.00', usdValue: 125 },
      { symbol: 'FLOAT', amount: '25000.00', usdValue: 25000 },
    ]);

    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem('dukapay-wallet', stateJson);
    }, JSON.stringify(walletState));

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

    // Mock float balance
    await page.route('**/api/agent/float', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            balance: 25000,
            currency: 'USDC',
            reserved: 5000,
            available: 20000,
          },
        }),
      });
    });
  });

  test('View float balance on agent dashboard', async ({ page }) => {
    await agentPage.navigateToAgentDashboard();

    // Verify float balance is displayed
    await expect(page.locator('[data-testid="float-balance"]')).toContainText('25,000');
    await expect(page.locator('[data-testid="available-float"]')).toContainText('20,000');
    await expect(page.locator('[data-testid="reserved-float"]')).toContainText('5,000');
  });

  test('Transfer float to another agent', async ({ page }) => {
    // Mock float transfer
    await page.route('**/api/agent/float/transfer', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            txHash: 'tx_float_transfer_123',
            amount: 5000,
            recipient: TEST_USERS.lender.publicKey,
            newBalance: 20000,
          },
        }),
      });
    });

    await agentPage.transferFloat({
      amount: '5000',
      recipientAddress: TEST_USERS.lender.publicKey,
      currency: 'USDC',
    });

    // Verify transfer success
    await expect(page.locator('text=/transfer.*successful|sent/i')).toBeVisible();
  });

  test('Add liquidity to float', async ({ page }) => {
    await agentPage.navigateToAgentDashboard();

    // Mock add liquidity
    await page.route('**/api/agent/float/add', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            txHash: 'tx_add_liquidity',
            amount: 10000,
            newBalance: 35000,
          },
        }),
      });
    });

    await page.click('button:has-text("Add Liquidity")');
    await page.fill('input[name="amount"]', '10000');
    await page.click('button:has-text("Confirm")');

    // Verify liquidity added
    await expect(page.locator('text=/liquidity.*added|deposit.*successful/i')).toBeVisible();
  });

  test('Withdraw float to personal wallet', async ({ page }) => {
    await agentPage.navigateToAgentDashboard();

    // Mock withdrawal
    await page.route('**/api/agent/float/withdraw', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            txHash: 'tx_withdraw_float',
            amount: 5000,
            newBalance: 20000,
          },
        }),
      });
    });

    await page.click('button:has-text("Withdraw Float")');
    await page.fill('input[name="amount"]', '5000');
    await page.click('button:has-text("Confirm Withdrawal")');

    // Verify withdrawal
    await expect(page.locator('text=/withdrawal.*successful|transferred/i')).toBeVisible();
  });

  test('Float transfer with insufficient balance', async ({ page }) => {
    await agentPage.navigateToAgentDashboard();

    await page.click('button:has-text("Transfer Float")');
    await page.fill('input[name="amount"]', '30000'); // More than available
    await page.fill('input[name="recipientAddress"]', TEST_USERS.lender.publicKey);
    await page.click('button:has-text("Review")');

    // Verify error
    await expect(page.locator('text=/insufficient.*float|not enough/i')).toBeVisible();
  });

  test('View float transaction history', async ({ page }) => {
    // Mock transaction history
    await page.route('**/api/agent/float/transactions', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'tx_1',
              type: 'transfer_out',
              amount: 5000,
              recipient: TEST_USERS.lender.publicKey,
              timestamp: '2026-03-15T10:00:00Z',
              status: 'completed',
            },
            {
              id: 'tx_2',
              type: 'deposit',
              amount: 10000,
              timestamp: '2026-03-10T14:00:00Z',
              status: 'completed',
            },
            {
              id: 'tx_3',
              type: 'withdrawal',
              amount: 3000,
              timestamp: '2026-03-05T09:00:00Z',
              status: 'completed',
            },
          ],
        }),
      });
    });

    await agentPage.viewTransactionHistory();

    // Verify transactions displayed
    await expect(page.locator('text=$5,000')).toBeVisible();
    await expect(page.locator('text=$10,000')).toBeVisible();
    await expect(page.locator('text=$3,000')).toBeVisible();
  });

  test('Filter float transactions by type', async ({ page }) => {
    await page.route('**/api/agent/float/transactions?type=transfer_out', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              type: 'transfer_out',
              amount: 5000,
              recipient: TEST_USERS.lender.publicKey,
            },
          ],
        }),
      });
    });

    await agentPage.viewTransactionHistory();
    await agentPage.filterTransactionsByType('transfer_out');

    // Verify only transfers shown
    await expect(page.locator('text=Transfer')).toBeVisible();
    await expect(page.locator('text=Deposit')).not.toBeVisible();
  });

  test('Set up float alerts', async ({ page }) => {
    await agentPage.navigateToAgentDashboard();

    // Mock alert configuration
    await page.route('**/api/agent/float/alerts', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            lowBalanceThreshold: 5000,
            alertEnabled: true,
          },
        }),
      });
    });

    await page.click('button:has-text("Float Settings")');
    await page.fill('input[name="lowBalanceThreshold"]', '5000');
    await page.click('input[type="checkbox"][name="enableAlerts"]');
    await page.click('button:has-text("Save Settings")');

    // Verify settings saved
    await expect(page.locator('text=/settings.*saved|preferences.*updated/i')).toBeVisible();
  });

  test('Bulk float distribution to multiple agents', async ({ page }) => {
    await agentPage.navigateToAgentDashboard();

    // Mock bulk transfer
    await page.route('**/api/agent/float/bulk-transfer', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            transfers: 3,
            totalAmount: 15000,
            txHashes: ['tx_1', 'tx_2', 'tx_3'],
          },
        }),
      });
    });

    await page.click('button:has-text("Bulk Transfer")');
    
    // Add recipients
    await page.click('button:has-text("Add Recipient")');
    await page.fill('input[name="recipients[0].address"]', TEST_USERS.lender.publicKey);
    await page.fill('input[name="recipients[0].amount"]', '5000');
    
    await page.click('button:has-text("Add Recipient")');
    await page.fill('input[name="recipients[1].address"]', TEST_USERS.borrower.publicKey);
    await page.fill('input[name="recipients[1].amount"]', '5000');
    
    await page.click('button:has-text("Review Bulk Transfer")');
    await page.click('button:has-text("Confirm All Transfers")');

    // Verify bulk transfer
    await expect(page.locator('text=/3.*transfers.*successful|bulk.*complete/i')).toBeVisible();
  });

  test('Float reconciliation report', async ({ page }) => {
    await agentPage.navigateToAgentDashboard();

    // Mock reconciliation data
    await page.route('**/api/agent/float/reconciliation', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            openingBalance: 30000,
            deposits: 10000,
            withdrawals: 5000,
            transfers: 10000,
            closingBalance: 25000,
            discrepancies: [],
          },
        }),
      });
    });

    await page.click('button:has-text("Reconciliation")');

    // Verify reconciliation summary
    await expect(page.locator('text=Opening Balance')).toBeVisible();
    await expect(page.locator('text=30,000')).toBeVisible();
    await expect(page.locator('text=Closing Balance')).toBeVisible();
    await expect(page.locator('text=25,000')).toBeVisible();
  });
});
