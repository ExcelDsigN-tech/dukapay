/**
 * Wallet Connection Page Object
 */
import { type Page, expect } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class WalletPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Connect wallet (mock)
   */
  async connectWallet(): Promise<void> {
    const connectButton = this.page.getByRole('button', { name: /connect wallet/i });
    if (await connectButton.isVisible()) {
      await connectButton.click();
    }
  }

  /**
   * Disconnect wallet
   */
  async disconnectWallet(): Promise<void> {
    await this.clickButton(/disconnect|logout/i);
  }

  /**
   * Verify wallet is connected
   */
  async verifyConnected(address: string): Promise<void> {
    const shortAddress = address.slice(0, 8);
    await expect(this.page.locator(`text=${shortAddress}`)).toBeVisible();
  }

  /**
   * Verify wallet is disconnected
   */
  async verifyDisconnected(): Promise<void> {
    await expect(this.page.getByRole('button', { name: /connect wallet/i })).toBeVisible();
  }

  /**
   * Get wallet balance for specific asset
   */
  async getBalance(asset: string): Promise<string> {
    const balanceText = await this.page.locator(`text=${asset}`).textContent();
    return balanceText || '0';
  }
}
