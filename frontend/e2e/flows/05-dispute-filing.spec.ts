/**
 * E2E Test: Dispute Filing Flow
 * Tests dispute creation, management, and resolution
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { TEST_USERS, createWalletState, createMockLoan } from '../utils/fixtures.js';
import { DisputePage } from '../utils/page-objects/DisputePage.js';
import { LoanPage } from '../utils/page-objects/LoanPage.js';

test.describe('Dispute Filing Flow', () => {
  let disputePage: DisputePage;
  let loanPage: LoanPage;
  const loanId = 42;
  const disputeId = 'disp_12345';

  test.beforeEach(async ({ page }: { page: Page }) => {
    disputePage = new DisputePage(page);
    loanPage = new LoanPage(page);

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

    // Mock active loan with issue
    await page.route('**/api/loans/borrower/**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            borrower: TEST_USERS.borrower.publicKey,
            loans: [createMockLoan({ id: loanId, status: 'active' })],
          },
        }),
      });
    });
  });

  test('File dispute for incorrect loan terms', async ({ page }) => {
    // Mock dispute creation
    await page.route('**/api/disputes', async (route: Route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: disputeId,
              loanId,
              status: 'pending',
              reason: 'incorrect_terms',
              submittedAt: new Date().toISOString(),
            },
          }),
        });
      }
    });

    // File dispute
    await disputePage.fileDispute({
      loanId,
      reason: 'incorrect_terms',
      description: 'The interest rate applied differs from what was agreed upon during approval.',
    });

    // Verify submission
    await expect(page.locator('text=/dispute.*submitted|under review/i')).toBeVisible();
    await expect(page.locator(`text=${disputeId}`)).toBeVisible();
  });

  test('File dispute with evidence documents', async ({ page }) => {
    await page.goto(`/en/loans/${loanId}/dispute`);

    // Select dispute reason
    await disputePage.selectDisputeReason('payment_not_reflected');
    await disputePage.fillDisputeDescription(
      'Made a payment but it was not reflected in my loan balance.',
    );

    // Note: In real test, would upload actual files
    // For E2E, we mock the upload
    await page.route('**/api/upload', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          urls: ['https://storage.dukapay.com/evidence_1.pdf'],
        }),
      });
    });

    // Mock dispute submission with evidence
    await page.route('**/api/disputes', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: disputeId,
            evidenceUrls: ['https://storage.dukapay.com/evidence_1.pdf'],
          },
        }),
      });
    });

    await disputePage.submitDispute();

    // Verify evidence was attached
    await expect(page.locator('text=/evidence.*attached|documents.*uploaded/i')).toBeVisible();
  });

  test('View dispute details and status', async ({ page }) => {
    // Mock dispute details
    await page.route(`**/api/disputes/${disputeId}`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: disputeId,
            loanId,
            status: 'under_review',
            reason: 'incorrect_terms',
            description: 'Interest rate discrepancy',
            submittedAt: '2026-03-01T10:00:00Z',
            borrower: TEST_USERS.borrower.publicKey,
          },
        }),
      });
    });

    await disputePage.viewDisputeDetails(disputeId);

    // Verify dispute details displayed
    await expect(page.locator('text=/dispute.*details/i')).toBeVisible();
    await disputePage.verifyDisputeStatus('under_review');
    await expect(page.locator('text=Interest rate discrepancy')).toBeVisible();
  });

  test('Add comment to dispute', async ({ page }) => {
    await page.route(`**/api/disputes/${disputeId}`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: disputeId,
            status: 'under_review',
          },
        }),
      });
    });

    // Mock comment submission
    await page.route(`**/api/disputes/${disputeId}/comments`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            commentId: 'cmt_123',
            text: 'Additional information: The payment was made on 2026-02-28.',
          },
        }),
      });
    });

    await disputePage.viewDisputeDetails(disputeId);
    await disputePage.addComment('Additional information: The payment was made on 2026-02-28.');

    // Verify comment added
    await expect(page.locator('text=Additional information')).toBeVisible();
  });

  test('Agent reviews and responds to dispute', async ({ page }) => {
    // Switch to agent context
    const agentWalletState = createWalletState(TEST_USERS.agent);
    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem('dukapay-wallet', stateJson);
    }, JSON.stringify(agentWalletState));

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

    await page.route(`**/api/disputes/${disputeId}`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: disputeId,
            status: 'under_review',
            reason: 'incorrect_terms',
          },
        }),
      });
    });

    // Mock resolution action
    await page.route(`**/api/disputes/${disputeId}/resolve`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            status: 'resolved',
            resolution: 'Terms corrected, interest rate adjusted',
          },
        }),
      });
    });

    await page.goto(`/en/agent/disputes/${disputeId}`);

    // Review and resolve
    await page.fill('textarea[name="resolution"]', 'Terms corrected, interest rate adjusted');
    await page.click('button:has-text("Resolve Dispute")');

    // Verify resolution
    await expect(page.locator('text=/resolved|closed/i')).toBeVisible();
  });

  test('Dispute escalation to admin', async ({ page }) => {
    await page.route(`**/api/disputes/${disputeId}`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: disputeId,
            status: 'under_review',
            escalated: false,
          },
        }),
      });
    });

    // Mock escalation
    await page.route(`**/api/disputes/${disputeId}/escalate`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            escalated: true,
            escalatedTo: 'admin',
          },
        }),
      });
    });

    await disputePage.viewDisputeDetails(disputeId);

    // Escalate dispute
    await page.click('button:has-text("Escalate")');
    await page.fill('textarea[name="escalationReason"]', 'Unable to resolve at agent level');
    await page.click('button:has-text("Confirm Escalation")');

    // Verify escalation
    await expect(page.locator('text=/escalated.*admin/i')).toBeVisible();
  });

  test('Withdraw dispute', async ({ page }) => {
    await page.route(`**/api/disputes/${disputeId}`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: disputeId,
            status: 'pending',
          },
        }),
      });
    });

    // Mock withdrawal
    await page.route(`**/api/disputes/${disputeId}/withdraw`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { status: 'withdrawn' },
        }),
      });
    });

    await disputePage.viewDisputeDetails(disputeId);
    await disputePage.withdrawDispute();

    // Verify withdrawal
    await expect(page.locator('text=/withdrawn|cancelled/i')).toBeVisible();
  });

  test('View dispute timeline', async ({ page }) => {
    await page.route(`**/api/disputes/${disputeId}`, async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: disputeId,
            timeline: [
              {
                event: 'Dispute submitted',
                timestamp: '2026-03-01T10:00:00Z',
                actor: TEST_USERS.borrower.publicKey,
              },
              {
                event: 'Under review by agent',
                timestamp: '2026-03-02T14:00:00Z',
                actor: TEST_USERS.agent.publicKey,
              },
              {
                event: 'Comment added',
                timestamp: '2026-03-03T09:00:00Z',
                actor: TEST_USERS.borrower.publicKey,
              },
            ],
          },
        }),
      });
    });

    await disputePage.viewDisputeDetails(disputeId);

    // Verify timeline events
    await disputePage.verifyDisputeTimeline([
      'Dispute submitted',
      'Under review by agent',
      'Comment added',
    ]);
  });

  test('Dispute list with filters', async ({ page }) => {
    // Mock disputes list
    await page.route('**/api/disputes?status=pending', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 'disp_1',
              loanId: 41,
              status: 'pending',
              reason: 'incorrect_terms',
            },
            {
              id: 'disp_2',
              loanId: 42,
              status: 'pending',
              reason: 'payment_not_reflected',
            },
          ],
        }),
      });
    });

    await page.goto('/en/disputes?status=pending');

    // Verify filtered disputes
    await expect(page.locator('text=disp_1')).toBeVisible();
    await expect(page.locator('text=disp_2')).toBeVisible();
    await expect(page.locator('text=Pending')).toHaveCount(2);
  });
});
