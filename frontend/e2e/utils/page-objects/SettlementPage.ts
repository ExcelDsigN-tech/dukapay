/**
 * Settlement Management Page Object
 */
import { type Page, expect } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class SettlementPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to settlement dashboard
   * NOTE: No /en/settlement or /en/settlement/stats route exists in src/app/[locale]/.
   * Settlement activity is aggregated in /en/activity and /en/remittances.
   * Mapping to /en/activity as closest real route until dedicated settlement UI is built.
   */
  async navigateToSettlement(): Promise<void> {
    await this.goto("/en/activity");
  }

  /**
   * View pending settlements
   */
  async viewPendingSettlements(): Promise<void> {
    await this.navigateToSettlement();
    await this.clickButton(/pending|awaiting settlement/i);
  }

  /**
   * Process batch settlement
   */
  async processBatchSettlement(remittanceIds: string[]): Promise<void> {
    await this.navigateToSettlement();

    // Select remittances for batch settlement
    for (const id of remittanceIds) {
      await this.page.click(`input[type="checkbox"][data-remittance-id="${id}"]`);
    }

    await this.clickButton(/batch settle|process selected/i);
    await this.clickButton(/confirm settlement/i);
    await this.expectTextVisible(/settlement.*successful|processed/i, 15000);
  }

  /**
   * View settlement history
   */
  async viewSettlementHistory(): Promise<void> {
    await this.navigateToSettlement();
    await this.clickButton(/history|completed settlements/i);
  }

  /**
   * Filter settlements by date range
   */
  async filterByDateRange(startDate: string, endDate: string): Promise<void> {
    await this.fillInput('input[name="startDate"]', startDate);
    await this.fillInput('input[name="endDate"]', endDate);
    await this.clickButton(/apply filter|filter/i);
    await this.wait(500);
  }

  /**
   * Get settlement summary
   */
  async getSettlementSummary(): Promise<{
    pendingCount: string;
    totalPendingAmount: string;
    completedToday: string;
  }> {
    await this.navigateToSettlement();

    const pendingCount =
      (await this.page.locator('[data-testid="pending-count"]').textContent()) || "0";
    const totalPendingAmount =
      (await this.page.locator('[data-testid="pending-amount"]').textContent()) || "0";
    const completedToday =
      (await this.page.locator('[data-testid="completed-today"]').textContent()) || "0";

    return { pendingCount, totalPendingAmount, completedToday };
  }

  /**
   * View settlement details
   */
  async viewSettlementDetails(settlementId: string): Promise<void> {
    await this.goto(`/en/activity`);
    await this.expectTextVisible(/activity|settlement.*details/i);
  }

  /**
   * Verify settlement status
   */
  async verifySettlementStatus(status: string): Promise<void> {
    const statusLocator = this.page.locator('[data-testid="settlement-status"]');
    await expect(statusLocator).toContainText(status, { ignoreCase: true });
  }

  /**
   * Export settlement report
   */
  async exportSettlementReport(format = "csv"): Promise<void> {
    await this.navigateToSettlement();
    await this.selectOption('select[name="exportFormat"]', format);
    await this.clickButton(/export|download/i);
    await this.wait(1000);
  }

  /**
   * Reconcile settlement
   */
  async reconcileSettlement(settlementId: string): Promise<void> {
    await this.viewSettlementDetails(settlementId);
    await this.clickButton(/reconcile/i);
    await this.expectTextVisible(/reconciliation.*complete/i, 10000);
  }

  /**
   * Retry failed settlement
   */
  async retryFailedSettlement(settlementId: string): Promise<void> {
    await this.viewSettlementDetails(settlementId);
    await this.clickButton(/retry/i);
    await this.clickButton(/confirm/i);
    await this.expectTextVisible(/processing|pending/i, 10000);
  }
}
