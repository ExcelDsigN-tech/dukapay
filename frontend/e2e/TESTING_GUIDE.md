# DukaPay E2E Testing Guide

Complete guide for writing, running, and maintaining E2E tests for DukaPay.

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Writing Tests](#writing-tests)
- [Test Patterns](#test-patterns)
- [Debugging](#debugging)
- [CI/CD Integration](#cicd-integration)
- [Troubleshooting](#troubleshooting)

## Quick Start

### Installation

```bash
cd frontend
npm install
npx playwright install
```

### Running Tests

```bash
# All tests
npm run test:e2e

# Specific flow (Unix/Linux/Mac)
./e2e/run-tests.sh flow loan

# Specific flow (Windows)
.\e2e\run-tests.ps1 flow loan

# With UI
npx playwright test --ui

# Single browser
npx playwright test --project=chromium
```

## Architecture

### Page Object Model (POM)

All UI interactions are encapsulated in Page Objects to:
- Reduce code duplication
- Improve maintainability
- Make tests more readable
- Isolate UI changes

**Structure:**

```
e2e/
├── flows/                  # Test files organized by user flow
│   ├── 01-agent-onboarding-kyc.spec.ts
│   ├── 02-cash-in-out.spec.ts
│   └── ...
├── utils/
│   ├── page-objects/       # Page Object classes
│   │   ├── BasePage.ts
│   │   ├── LoanPage.ts
│   │   └── ...
│   ├── fixtures.ts         # Test data and mocks
│   └── index.ts           # Utility exports
└── README.md
```

### Test Isolation

Each test is completely isolated:

1. **No shared state** between tests
2. **All API calls mocked** - no external dependencies
3. **Fresh browser context** for each test
4. **Independent test data** using fixtures

## Writing Tests

### Basic Test Structure

```typescript
import { test, expect, type Page } from '@playwright/test';
import { LoanPage, TEST_USERS, createWalletState } from '../utils/index.js';

test.describe('Loan Flow', () => {
  let loanPage: LoanPage;

  test.beforeEach(async ({ page }: { page: Page }) => {
    loanPage = new LoanPage(page);
    
    // Setup wallet and user
    const walletState = createWalletState(TEST_USERS.borrower);
    await page.addInitScript((stateJson: string) => {
      window.localStorage.setItem('dukapay-wallet', stateJson);
    }, JSON.stringify(walletState));
    
    // Mock APIs
    await page.route('**/api/user/profile', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test_user',
          kycVerified: true,
        }),
      });
    });
  });

  test('should apply for loan', async ({ page }) => {
    // Arrange
    await page.goto('/en');
    
    // Act
    await loanPage.applyForLoan('1000', 'USDC');
    
    // Assert
    await expect(page.locator('text=/application.*submitted/i')).toBeVisible();
  });
});
```

### Using Page Objects

**Good ✅:**
```typescript
await loanPage.applyForLoan('1000', 'USDC');
await loanPage.verifyLoanStatus('Active');
```

**Bad ❌:**
```typescript
await page.click('button:has-text("Apply")');
await page.fill('input[name="amount"]', '1000');
// ... repeated across tests
```

### Creating a New Page Object

```typescript
import { type Page } from '@playwright/test';
import { BasePage } from './BasePage.js';

export class MyNewPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to page
   */
  async navigateToMyPage(): Promise<void> {
    await this.goto('/en/my-page');
  }

  /**
   * Perform action
   */
  async performAction(data: string): Promise<void> {
    await this.fillInput('input[name="field"]', data);
    await this.clickButton(/submit/i);
    await this.expectTextVisible(/success/i);
  }
}
```

## Test Patterns

### 1. API Mocking

Always mock external APIs:

```typescript
await page.route('**/api/endpoint', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: { /* your test data */ },
    }),
  });
});
```

### 2. Test Data with Fixtures

Use fixtures for consistent test data:

```typescript
import { createMockLoan, TEST_USERS } from '../utils/fixtures.js';

const testLoan = createMockLoan({
  amount: 1000,
  status: 'active',
  borrower: TEST_USERS.borrower.publicKey,
});
```

### 3. Waiting for Elements

**Preferred:**
```typescript
await expect(page.locator('text=Success')).toBeVisible({ timeout: 10000 });
```

**Avoid:**
```typescript
await page.waitForTimeout(5000); // ❌ Flaky!
```

### 4. Assertions

Be specific with assertions:

```typescript
// Good ✅
await expect(page.locator('[data-testid="balance"]')).toContainText('1,000');
await expect(page.locator('text=Active')).toBeVisible();

// Bad ❌
await expect(page.locator('div')).toBeVisible(); // Too generic
```

### 5. Error Handling

Test both success and failure paths:

```typescript
test('should handle insufficient balance', async ({ page }) => {
  await page.route('**/api/transfer', async (route) => {
    await route.fulfill({
      status: 400,
      body: JSON.stringify({
        success: false,
        error: 'Insufficient balance',
      }),
    });
  });

  await page.click('button:has-text("Transfer")');
  await expect(page.locator('text=/insufficient.*balance/i')).toBeVisible();
});
```

## Debugging

### 1. Visual Debugging

```bash
# Headed mode (see browser)
npx playwright test --headed

# Slow motion
npx playwright test --headed --slow-mo=1000

# UI mode (recommended)
npx playwright test --ui
```

### 2. Debug Specific Test

```bash
# Unix/Linux/Mac
./e2e/run-tests.sh debug "loan application"

# Windows
.\e2e\run-tests.ps1 debug "loan application"

# Or directly
npx playwright test --grep="loan application" --debug
```

### 3. Screenshots & Videos

Automatically captured on failure:

```typescript
// Manual screenshot
await page.screenshot({ path: 'debug-screenshot.png' });

// Full page screenshot
await page.screenshot({ path: 'debug.png', fullPage: true });
```

### 4. Console Logs

```typescript
// Listen to console
page.on('console', msg => console.log('PAGE LOG:', msg.text()));

// Listen to errors
page.on('pageerror', error => console.log('PAGE ERROR:', error));
```

### 5. Network Inspection

```typescript
// Log all requests
page.on('request', request => {
  console.log('>>', request.method(), request.url());
});

// Log responses
page.on('response', response => {
  console.log('<<', response.status(), response.url());
});
```

## CI/CD Integration

### GitHub Actions Workflow

Tests run automatically on PR:

```yaml
# Defined in .github/workflows/e2e-tests.yml
- Main test suite (blocking)
- Flaky tests (non-blocking)
- Multiple browsers (chromium, firefox, webkit)
- Test sharding for parallel execution
```

### Test Reports

After CI run:
1. Go to Actions tab
2. Click on workflow run
3. Download `playwright-report` artifact
4. Extract and open `index.html`

### Flaky Test Management

Tests tagged with `@flaky` run separately and don't block PRs:

```typescript
test('[@flaky] Real-time sync', async ({ page }) => {
  // Test implementation
});
```

**Criteria for @flaky tag:**
- Success rate < 95% in CI
- Timing-dependent behavior
- External dependency issues
- Browser-specific inconsistencies

## Test Coverage Matrix

| Flow | Feature | Status |
|------|---------|--------|
| KYC | Agent registration | ✅ |
| KYC | Document upload | ✅ |
| KYC | Approval/rejection | ✅ |
| Cash-in/out | Send remittance | ✅ |
| Cash-in/out | View history | ✅ |
| Cash-in/out | NFT certificate | ✅ |
| Loan | Application | ✅ |
| Loan | Approval | ✅ |
| Loan | Funding | ✅ |
| Loan | Rejection | ✅ |
| Repayment | Full repayment | ✅ |
| Repayment | Partial payment | ✅ |
| Repayment | Early payoff | ✅ |
| Dispute | File dispute | ✅ |
| Dispute | Add evidence | ✅ |
| Dispute | Resolution | ✅ |
| Dispute | Escalation | ✅ |
| Float | Transfer | ✅ |
| Float | Add liquidity | ✅ |
| Float | Withdraw | ✅ |
| Float | Reconciliation | ✅ |
| Settlement | Single process | ✅ |
| Settlement | Batch process | ✅ |
| Settlement | Reconciliation | ✅ |
| Settlement | Retry failed | ✅ |

## Troubleshooting

### Issue: Test timeouts

**Solution:**
```typescript
// Increase timeout for specific test
test('slow operation', async ({ page }) => {
  test.setTimeout(90000); // 90 seconds
  // ... test code
});
```

### Issue: Flaky selectors

**Solution:**
Use data-testid attributes:

```typescript
// In component
<button data-testid="submit-loan">Submit</button>

// In test
await page.getByTestId('submit-loan').click();
```

### Issue: Race conditions

**Solution:**
Wait for network idle:

```typescript
await page.goto('/en', { waitUntil: 'networkidle' });
await page.waitForLoadState('networkidle');
```

### Issue: Modal not appearing

**Solution:**
```typescript
// Wait for modal to be attached to DOM
const modal = page.locator('[role="dialog"]');
await modal.waitFor({ state: 'attached' });
await expect(modal).toBeVisible();
```

### Issue: Tests pass locally but fail in CI

**Possible causes:**
1. Timing differences (slower CI)
2. Screen resolution differences
3. Missing dependencies
4. Environment variables

**Solution:**
```bash
# Run locally with CI settings
CI=true npx playwright test
```

## Best Practices Checklist

- [ ] Test is in correct flow file
- [ ] Uses Page Object Model
- [ ] All APIs are mocked
- [ ] Test data from fixtures
- [ ] No hard-coded waits
- [ ] Meaningful test name
- [ ] Independent of other tests
- [ ] Proper assertions
- [ ] Error cases tested
- [ ] Comments for complex logic

## Resources

- [Playwright Docs](https://playwright.dev)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Page Object Model](https://playwright.dev/docs/pom)
- [Debugging Guide](https://playwright.dev/docs/debug)

## Getting Help

- Check existing tests for examples
- Read the [E2E README](./README.md)
- Ask in Telegram: https://t.me/+eRqhka27TVo0NzM8
- Open GitHub Discussion for architecture questions
