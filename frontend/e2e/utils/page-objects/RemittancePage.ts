/**
 * Remittance (Cash-in/out) Page Object
 */
import { type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class RemittancePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to send remittance page
   */
  async navigateToSendRemittance(): Promise<void> {
    await this.goto('/en/remittances/send');
  }

  /**
   * Navigate to remittance history
   */
  async navigateToHistory(): Promise<void> {
    await this.goto('/en/remittances');
  }

  /**
   * Fill recipient details
   */
  async fillRecipientDetails(address: string): Promise<void> {
    await this.fillInput('input[name="recipientAddress"]', address);
  }

  /**
   * Fill remittance amount
   */
  async fillAmount(amount: string, currency = 'USDC'): Promise<void> {
    await this.selectOption('select[name="fromCurrency"]', currency);
    await this.fillInput('input[name="amount"]', amount);
  }

  /**
   * Select destination currency
   */
  async selectDestinationCurrency(currency: string): Promise<void> {
    await this.selectOption('select[name="toCurrency"]', currency);
  }

  /**
   * Review and confirm remittance
   */
  async reviewAndConfirm(): Promise<void> {
    await this.clickButton(/review|continue/i);
    await this.expectTextVisible(/confirm|review details/i);
    await this.clickButton(/confirm.*send|send remittance/i);
  }

  /**
   * Complete full remittance flow
   */
  async sendRemittance(data: {
    recipientAddress: string;
    amount: string;
    fromCurrency?: string;
    toCurrency?: string;
  }): Promise<void> {
    await this.navigateToSendRemittance();
    await this.fillRecipientDetails(data.recipientAddress);
    await this.fillAmount(data.amount, data.fromCurrency);
    
    if (data.toCurrency) {
      await this.selectDestinationCurrency(data.toCurrency);
    }
    
    await this.reviewAndConfirm();
    await this.expectTextVisible(/success|sent|completed/i, 15000);
  }

  /**
   * Verify remittance in history
   */
  async verifyRemittanceInHistory(amount: string, status = 'completed'): Promise<void> {
    await this.navigateToHistory();
    await this.expectTextVisible(/history/i);
    await expect(this.page.locator(`text=${amount}`)).toBeVisible();
    await expect(this.page.locator(`text=${status}`)).toBeVisible();
  }

  /**
   * View remittance NFT
   */
  async viewRemittanceNFT(remittanceId: string): Promise<void> {
    await this.goto(`/en/remittances/${remittanceId}`);
    await this.expectTextVisible(/nft|certificate|proof/i);
  }

  /**
   * Filter remittances by status
   */
  async filterByStatus(status: string): Promise<void> {
    await this.selectOption('select[name="statusFilter"]', status);
    await this.wait(500); // Wait for filter to apply
  }

  /**
   * Get exchange rate
   */
  async getExchangeRate(): Promise<string> {
    const rateElement = await this.page.locator('[data-testid="exchange-rate"]').textContent();
    return rateElement || '0';
  }
}
