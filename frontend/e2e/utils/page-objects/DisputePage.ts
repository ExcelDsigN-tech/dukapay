/**
 * Dispute Management Page Object
 */
import { type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class DisputePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to dispute filing page
   */
  async navigateToFileDispute(loanId: number): Promise<void> {
    await this.goto(`/en/loans/${loanId}/dispute`);
  }

  /**
   * Select dispute reason
   */
  async selectDisputeReason(reason: string): Promise<void> {
    await this.selectOption('select[name="disputeReason"]', reason);
  }

  /**
   * Fill dispute description
   */
  async fillDisputeDescription(description: string): Promise<void> {
    await this.fillInput('textarea[name="description"]', description);
  }

  /**
   * Upload evidence documents
   */
  async uploadEvidence(filePaths: string[]): Promise<void> {
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePaths);
  }

  /**
   * Submit dispute
   */
  async submitDispute(): Promise<void> {
    await this.clickButton(/submit dispute|file dispute/i);
  }

  /**
   * Complete full dispute filing flow
   */
  async fileDispute(data: {
    loanId: number;
    reason: string;
    description: string;
    evidencePaths?: string[];
  }): Promise<void> {
    await this.navigateToFileDispute(data.loanId);
    await this.selectDisputeReason(data.reason);
    await this.fillDisputeDescription(data.description);
    
    if (data.evidencePaths && data.evidencePaths.length > 0) {
      await this.uploadEvidence(data.evidencePaths);
    }
    
    await this.submitDispute();
    await this.expectTextVisible(/dispute.*submitted|under review/i, 10000);
  }

  /**
   * View dispute details
   */
  async viewDisputeDetails(disputeId: string): Promise<void> {
    await this.goto(`/en/disputes/${disputeId}`);
  }

  /**
   * Verify dispute status
   */
  async verifyDisputeStatus(status: string): Promise<void> {
    const statusLocator = this.page.locator('[data-testid="dispute-status"]');
    await expect(statusLocator).toContainText(status, { ignoreCase: true });
  }

  /**
   * Add comment to dispute
   */
  async addComment(comment: string): Promise<void> {
    await this.fillInput('textarea[name="comment"]', comment);
    await this.clickButton(/add comment|post/i);
    await this.expectTextVisible(comment);
  }

  /**
   * Withdraw dispute
   */
  async withdrawDispute(): Promise<void> {
    await this.clickButton(/withdraw dispute/i);
    await this.clickButton(/confirm/i);
    await this.expectTextVisible(/withdrawn/i);
  }

  /**
   * Verify dispute timeline
   */
  async verifyDisputeTimeline(expectedEvents: string[]): Promise<void> {
    for (const event of expectedEvents) {
      await expect(this.page.locator(`text=${event}`)).toBeVisible();
    }
  }
}
