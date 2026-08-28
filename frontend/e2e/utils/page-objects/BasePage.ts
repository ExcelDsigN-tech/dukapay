/**
 * Base Page Object Model
 * Provides common functionality for all page objects
 */
import { type Page, type Locator, expect } from '@playwright/test';

export class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to a specific path
   */
  async goto(path: string): Promise<void> {
    await this.page.goto(path);
  }

  /**
   * Wait for page to be fully loaded
   */
  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Click on a button by text
   */
  async clickButton(text: string | RegExp): Promise<void> {
    await this.page.getByRole('button', { name: text }).click();
  }

  /**
   * Fill input field
   */
  async fillInput(selector: string, value: string): Promise<void> {
    await this.page.fill(selector, value);
  }

  /**
   * Select option from dropdown
   */
  async selectOption(selector: string, value: string): Promise<void> {
    await this.page.selectOption(selector, value);
  }

  /**
   * Check if text is visible
   */
  async expectTextVisible(text: string | RegExp, timeout = 10000): Promise<void> {
    await expect(this.page.locator(`text=${text}`)).toBeVisible({ timeout });
  }

  /**
   * Get locator by test ID
   */
  getByTestId(testId: string): Locator {
    return this.page.getByTestId(testId);
  }

  /**
   * Wait for API response
   */
  async waitForApiResponse(urlPattern: string | RegExp): Promise<any> {
    const response = await this.page.waitForResponse(urlPattern);
    return response.json();
  }

  /**
   * Take screenshot (useful for debugging)
   */
  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
  }

  /**
   * Scroll element into view
   */
  async scrollIntoView(selector: string): Promise<void> {
    await this.page.locator(selector).scrollIntoViewIfNeeded();
  }

  /**
   * Wait for specific amount of time (use sparingly)
   */
  async wait(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }
}
