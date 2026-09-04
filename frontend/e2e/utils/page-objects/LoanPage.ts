/**
 * Loan Management Page Object
 */
import { type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class LoanPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to loan application page
   */
  async navigateToLoanApplication(): Promise<void> {
    await this.clickButton(/apply for loan|request loan/i);
  }

  /**
   * Fill loan amount and asset
   */
  async fillLoanDetails(amount: string, asset = 'USDC'): Promise<void> {
    await this.selectOption('select[name="asset"]', asset);
    await this.fillInput('input[placeholder="0.00"]', amount);
  }

  /**
   * Continue to collateral step
   */
  async continueToCollateral(): Promise<void> {
    await this.clickButton(/continue to collateral/i);
  }

  /**
   * Accept loan terms
   */
  async acceptLoanTerms(): Promise<void> {
    await this.page.click('input[type="checkbox"]');
  }

  /**
   * Continue to signature step
   */
  async continueToSignature(): Promise<void> {
    await this.clickButton(/continue to signature/i);
  }

  /**
   * Submit loan application
   */
  async submitLoanApplication(): Promise<void> {
    await this.clickButton(/sign.*submit|submit application/i);
  }

  /**
   * Complete full loan application flow
   */
  async applyForLoan(amount: string, asset = 'USDC'): Promise<void> {
    await this.navigateToLoanApplication();
    await this.fillLoanDetails(amount, asset);
    await this.continueToCollateral();
    await this.expectTextVisible(/collateral|nft/i);
    await this.acceptLoanTerms();
    await this.continueToSignature();
    await this.expectTextVisible(/ready to sign|signature/i);
    await this.submitLoanApplication();
    await this.expectTextVisible(/submitted|pending/i, 15000);
  }

  /**
   * View loan details
   */
  async viewLoanDetails(loanId: number): Promise<void> {
    await this.goto(`/en/loans/${loanId}`);
  }

  /**
   * Verify loan status
   */
  async verifyLoanStatus(status: string): Promise<void> {
    await expect(this.page.locator(`text=${status}`)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Make repayment
   */
  async makeRepayment(amount: string): Promise<void> {
    await this.clickButton(/repay/i);
    await this.expectTextVisible(/repayment amount/i);
    await this.fillInput('input[type="number"]', amount);
    await this.clickButton(/review repayment/i);
    await this.clickButton(/confirm payment/i);
    await this.expectTextVisible(/repayment successful/i, 15000);
  }

  /**
   * Get loan balance
   */
  async getLoanBalance(): Promise<string> {
    const balanceElement = await this.page.locator('[data-testid="loan-balance"]').textContent();
    return balanceElement || '0';
  }

  /**
   * Verify loan timeline events
   */
  async verifyTimelineEvents(expectedEvents: string[]): Promise<void> {
    await this.expectTextVisible(/timeline|history/i);
    
    for (const event of expectedEvents) {
      await expect(this.page.locator(`text=${event}`)).toBeVisible();
    }
  }

  /**
   * Export loan history CSV
   */
  async exportLoanHistory(): Promise<void> {
    await this.clickButton(/export csv/i);
    // Wait for download to start
    await this.wait(1000);
  }
}
