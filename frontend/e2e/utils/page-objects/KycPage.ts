/**
 * KYC/AML Onboarding Page Object
 */
import { type Page, expect } from "@playwright/test";
import { BasePage } from "./BasePage.js";

export class KycPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to KYC page
   * NOTE: Dedicated /en/kyc route does not exist in src/app/[locale]/ (no kyc directory).
   * KYC status is surfaced in /en/settings (Security section) and via POST /auth/kyc.
   * Mapping to /en/settings as the closest real route until a dedicated KYC page is built.
   * If product restores a dedicated KYC route, update this to that path.
   */
  async navigateToKyc(): Promise<void> {
    await this.goto("/en/settings");
  }

  /**
   * Fill personal information
   */
  async fillPersonalInfo(data: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    countryCode: string;
  }): Promise<void> {
    await this.fillInput('input[name="firstName"]', data.firstName);
    await this.fillInput('input[name="lastName"]', data.lastName);
    await this.fillInput('input[name="dateOfBirth"]', data.dateOfBirth);
    await this.selectOption('select[name="countryCode"]', data.countryCode);
  }

  /**
   * Upload document
   */
  async uploadDocument(filePath: string, documentType = "passport"): Promise<void> {
    await this.selectOption('select[name="documentType"]', documentType);
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);
  }

  /**
   * Accept terms and conditions
   */
  async acceptTerms(): Promise<void> {
    await this.page.click('input[type="checkbox"][name="termsAccepted"]');
  }

  /**
   * Submit KYC application
   */
  async submitKyc(): Promise<void> {
    await this.clickButton(/submit.*kyc|submit application/i);
  }

  /**
   * Verify KYC status
   */
  async verifyKycStatus(expectedStatus: "pending" | "approved" | "rejected"): Promise<void> {
    const statusLocator = this.page.locator('[data-testid="kyc-status"]');
    await expect(statusLocator).toContainText(expectedStatus, { ignoreCase: true });
  }

  /**
   * Complete full KYC flow
   */
  async completeKyc(data: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    countryCode: string;
    documentPath?: string;
  }): Promise<void> {
    await this.fillPersonalInfo(data);

    if (data.documentPath) {
      await this.uploadDocument(data.documentPath);
    }

    await this.acceptTerms();
    await this.submitKyc();

    // Wait for submission confirmation
    await this.expectTextVisible(/submitted|pending review/i);
  }
}
