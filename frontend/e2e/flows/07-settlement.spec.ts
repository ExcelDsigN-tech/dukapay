/**
 * E2E Test: Settlement Flow
 * Tests remittance settlement and reconciliation processes
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { TEST_USERS, createWalletState, createMockRemittance } from '../utils/fixtures.js';
import { SettlementPage } from '../utils/page-objects/SettlementPage.js';
import { AgentPage } from '../utils/page-objects/AgentPage.js';

test.describe('Settlement Flow', () => {
  let settlementPage: SettlementPage;
  let agentPage: AgentPage;

  test.beforeEach(async ({ page }: { page: Page }) => {
    settlementPage = new SettlementPage(page);
    agentPage = new AgentPage(page);

    // Mock agent wallet
    const walletState = createWalletState(TEST_USERS.agent);
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

    // Mock pending settlements
    await page.route('**/api/settlements*', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            settlements: [
              {
                id: 'settle_1',
                remittanceId: 'rem_1',
                amount: 500,
                status: 'pending',
                currency: 'USDC',
                createdAt: '2026-03-15T10:00:00Z',
              },
              {
                id: 'settle_2',
                remittanceId: 'rem_2',
                amount: 250,
                status: 'pending',
                currency: 'USDC',
                createdAt: '2026-03-15T11:00:00Z',
              },
            ],
            summary: {
              pendingCount: 2,
              totalPendingAmount: 750,
              completedToday: 5,
            },
          },
        }),
      });
    });
  });

  test('View pending settlements dashboard', async ({ page }) => {
    await settlementPage.navigateToSettlement();

    // Verify dashboard displays pending settlements
    await expect(page.locator('text=/pending.*settlements/i')).toBeVisible();
    await expect(page.locator('text=$500')).toBeVisible();
    await expect(page.locator('text=$250')).toBeVisible();

    // Verify summary stats
    const summary = await settlementPage.getSettlementSummary();
    expect(summary.pendingCount).toContain('2');
    expect(summary.totalPendingAmount).toContain('750');
  });

  test('Process single settlement', async ({ page }) => {
    const settlementId = 'settle_1';
    const remittanceId = 'rem_1';

    // Mock settlement processing
    await page.route(`**/api/settlements/${settlementId}/process`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: settlementId,
            status: 'completed',
            txHash: 'tx_settle_123',
            settledAt: new Date().toISOString(),
          },
        }),
      });
    });

    await agentPage.processSettlement(remittanceId);

    // Verify settlement processed
    await expect(page.locator('text=/settlement.*successful|completed/i')).toBeVisible();
  });

  test('Batch settlement processing', async ({ page }) => {
    const remittanceIds = ['rem_1', 'rem_2', 'rem_3'];

    // Mock batch settlement
    await page.route('**/api/settlements/batch', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            processed: 3,
            totalAmount: 1000,
            txHashes: ['tx_1', 'tx_2', 'tx_3'],
            failed: 0,
          },
        }),
      });
    });

    await settlementPage.processBatchSettlement(remittanceIds);

    // Verify batch settlement
    await expect(page.locator('text=/3.*settlement.*processed|batch.*complete/i')).toBeVisible();
  });

  test('View settlement history', async ({ page }) => {
    // Mock settlement history
    await page.route('**/api/settlements/history', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'settle_completed_1',
              remittanceId: 'rem_10',
              amount: 1000,
              status: 'completed',
              settledAt: '2026-03-14T15:00:00Z',
              txHash: 'tx_settle_old',
            },
            {
              id: 'settle_completed_2',
              remittanceId: 'rem_11',
              amount: 750,
              status: 'completed',
              settledAt: '2026-03-14T16:00:00Z',
              txHash: 'tx_settle_old_2',
            },
          ],
        }),
      });
    });

    await settlementPage.viewSettlementHistory();

    // Verify history displayed
    await expect(page.locator('text=$1,000')).toBeVisible();
    await expect(page.locator('text=$750')).toBeVisible();
    await expect(page.locator('text=Completed')).toHaveCount(2);
  });

  test('Filter settlements by date range', async ({ page }) => {
    await settlementPage.navigateToSettlement();

    // Apply date filter
    await settlementPage.filterByDateRange('2026-03-01', '2026-03-15');

    // Mock filtered results
    await page.route('**/api/settlements?from=2026-03-01&to=2026-03-15', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            settlements: [
              {
                id: 'settle_filtered',
                amount: 300,
                status: 'completed',
              },
            ],
          },
        }),
      });
    });

    // Verify filtered results
    await expect(page.locator('text=$300')).toBeVisible();
  });

  test('Settlement reconciliation', async ({ page }) => {
    const settlementId = 'settle_123';

    // Mock settlement details
    await page.route(`**/api/settlements/${settlementId}`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: settlementId,
            remittanceId: 'rem_123',
            amount: 500,
            status: 'completed',
            txHash: 'tx_settle_rec',
            settledAt: '2026-03-15T10:00:00Z',
          },
        }),
      });
    });

    // Mock reconciliation
    await page.route(`**/api/settlements/${settlementId}/reconcile`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            reconciled: true,
            discrepancies: [],
            blockchainAmount: 500,
            recordedAmount: 500,
          },
        }),
      });
    });

    await settlementPage.reconcileSettlement(settlementId);

    // Verify reconciliation
    await expect(page.locator('text=/reconciliation.*complete|matched/i')).toBeVisible();
  });

  test('Settlement with discrepancy detection', async ({ page }) => {
    const settlementId = 'settle_discrepancy';

    await page.route(`**/api/settlements/${settlementId}/reconcile`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            reconciled: false,
            discrepancies: [
              {
                type: 'amount_mismatch',
                expected: 500,
                actual: 495,
                difference: 5,
              },
            ],
            blockchainAmount: 495,
            recordedAmount: 500,
          },
        }),
      });
    });

    await settlementPage.viewSettlementDetails(settlementId);
    await page.click('button:has-text("Reconcile")');

    // Verify discrepancy warning
    await expect(page.locator('text=/discrepancy.*detected|mismatch/i')).toBeVisible();
    await expect(page.locator('text=5')).toBeVisible(); // Difference amount
  });

  test('Failed settlement retry', async ({ page }) => {
    const settlementId = 'settle_failed';

    // Mock failed settlement
    await page.route(`**/api/settlements/${settlementId}`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: settlementId,
            status: 'failed',
            failureReason: 'Network timeout',
          },
        }),
      });
    });

    // Mock retry
    await page.route(`**/api/settlements/${settlementId}/retry`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            status: 'pending',
            retryAttempt: 1,
          },
        }),
      });
    });

    await settlementPage.retryFailedSettlement(settlementId);

    // Verify retry initiated
    await expect(page.locator('text=/retry.*initiated|processing/i')).toBeVisible();
  });

  test('Export settlement report', async ({ page }) => {
    await settlementPage.navigateToSettlement();

    // Mock export
    await page.route('**/api/settlements/export', async (route: Route) => {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename=settlements.csv',
        },
        body: 'ID,Amount,Status,Date\nsettle_1,500,completed,2026-03-15',
      });
    });

    await settlementPage.exportSettlementReport('csv');

    // Verify download initiated
    // In real test, would check download event
  });

  test('Settlement notifications', async ({ page }) => {
    await settlementPage.navigateToSettlement();

    // Mock notifications
    await page.route('**/api/notifications', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'notif_1',
              type: 'settlement_completed',
              message: 'Settlement settle_1 completed successfully',
              read: false,
              createdAt: '2026-03-15T10:30:00Z',
            },
          ],
        }),
      });
    });

    // Verify settlement notification
    await expect(page.locator('text=/settlement.*completed/i')).toBeVisible();
  });

  test('View settlement statistics', async ({ page }) => {
    await settlementPage.navigateToSettlement();

    // Mock statistics
    await page.route('**/api/settlements/stats', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            today: {
              completed: 15,
              totalAmount: 7500,
              averageTime: 120, // seconds
            },
            week: {
              completed: 89,
              totalAmount: 45000,
            },
            month: {
              completed: 350,
              totalAmount: 175000,
            },
          },
        }),
      });
    });

    await page.goto('/en/settlement/stats');

    // Verify statistics displayed
    await expect(page.locator('text=15')).toBeVisible(); // Today's count
    await expect(page.locator('text=$7,500')).toBeVisible();
    await expect(page.locator('text=89')).toBeVisible(); // Week's count
  });
});
