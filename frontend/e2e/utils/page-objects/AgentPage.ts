/**
 * Agent Dashboard Page Object
 */
import { type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class AgentPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to agent dashboard
   */
  async navigateToAgentDashboard(): Promise<void> {
    await this.goto('/en/agent');
  }

  /**
   * View pending loan applications
   */
  async viewPendingApplications(): Promise<void> {
    await this.clickButton(/pending.*applications|review loans/i);
  }

  /**
   * Review loan application
   */
  async reviewLoanApplication(loanId: number): Promise<void> {
    await this.goto(`/en/agent/loans/${loanId}`);
    await this.expectTextVisible(/loan application|review/i);
  }

  /**
   * Approve loan
   */
  async approveLoan(loanId: number, comment?: string): Promise<void> {
    await this.reviewLoanApplication(loanId);
    
    if (comment) {
      await this.fillInput('textarea[name="comment"]', comment);
    }
    
    await this.clickButton(/approve/i);
    await this.clickButton(/confirm.*approval/i);
    await this.expectTextVisible(/approved/i, 10000);
  }

  /**
   * Reject loan
   */
  async rejectLoan(loanId: number, reason: string): Promise<void> {
    await this.reviewLoanApplication(loanId);
    await this.clickButton(/reject/i);
    await this.fillInput('textarea[name="rejectionReason"]', reason);
    await this.clickButton(/confirm.*rejection/i);
    await this.expectTextVisible(/rejected/i, 10000);
  }

  /**
   * View float balance
   */
  async getFloatBalance(): Promise<string> {
    await this.navigateToAgentDashboard();
    const balanceElement = await this.page.locator('[data-testid="float-balance"]').textContent();
    return balanceElement || '0';
  }

  /**
   * Transfer float
   */
  async transferFloat(data: {
    amount: string;
    recipientAddress: string;
    currency?: string;
  }): Promise<void> {
    await this.navigateToAgentDashboard();
    await this.clickButton(/transfer float|manage float/i);
    await this.fillInput('input[name="amount"]', data.amount);
    await this.fillInput('input[name="recipientAddress"]', data.recipientAddress);
    
    if (data.currency) {
      await this.selectOption('select[name="currency"]', data.currency);
    }
    
    await this.clickButton(/review transfer/i);
    await this.clickButton(/confirm transfer/i);
    await this.expectTextVisible(/transfer.*successful|sent/i, 10000);
  }

  /**
   * View agent statistics
   */
  async getAgentStats(): Promise<{
    loansProcessed: string;
    remittancesCompleted: string;
    totalVolume: string;
  }> {
    await this.navigateToAgentDashboard();
    
    const loansProcessed = await this.page.locator('[data-testid="loans-processed"]').textContent() || '0';
    const remittancesCompleted = await this.page.locator('[data-testid="remittances-completed"]').textContent() || '0';
    const totalVolume = await this.page.locator('[data-testid="total-volume"]').textContent() || '0';
    
    return { loansProcessed, remittancesCompleted, totalVolume };
  }

  /**
   * Process remittance settlement
   */
  async processSettlement(remittanceId: string): Promise<void> {
    await this.goto(`/en/agent/remittances/${remittanceId}`);
    await this.clickButton(/settle|confirm settlement/i);
    await this.clickButton(/confirm/i);
    await this.expectTextVisible(/settled|completed/i, 10000);
  }

  /**
   * View transaction history
   */
  async viewTransactionHistory(): Promise<void> {
    await this.navigateToAgentDashboard();
    await this.clickButton(/transactions|history/i);
    await this.expectTextVisible(/transaction.*history/i);
  }

  /**
   * Filter transactions by type
   */
  async filterTransactionsByType(type: string): Promise<void> {
    await this.selectOption('select[name="transactionType"]', type);
    await this.wait(500);
  }

  /**
   * Export agent report
   */
  async exportReport(reportType = 'monthly'): Promise<void> {
    await this.navigateToAgentDashboard();
    await this.selectOption('select[name="reportType"]', reportType);
    await this.clickButton(/export|download report/i);
    await this.wait(1000);
  }
}
