# End-to-End Test Suite

Comprehensive Playwright E2E test coverage for DukaPay's critical user flows.

## 🎯 Coverage

This test suite covers 8 critical user flows with complete Page Object Model implementation:

### 1. **Agent Onboarding & KYC** (`flows/01-agent-onboarding-kyc.spec.ts`)
- Agent registration and wallet connection
- KYC form submission with document upload
- KYC approval/rejection handling
- Dashboard access after verification

### 2. **Cash-in/Cash-out (Remittance)** (`flows/02-cash-in-out.spec.ts`)
- Send remittance with currency conversion
- View remittance history and status
- Exchange rate calculation
- NFT certificate viewing
- Balance validation

### 3. **Loan Application → Approval → Funding** (`flows/03-loan-application-approval-funding.spec.ts`)
- Complete loan application flow
- Credit score verification
- Agent loan review and approval
- Loan funding and disbursement
- Loan rejection handling
- Event timeline tracking

### 4. **Loan Repayment** (`flows/04-loan-repayment.spec.ts`)
- Full and partial repayments
- Multiple payment installments
- Early repayment with interest reduction
- Balance verification
- Repayment history and receipts

### 5. **Dispute Filing** (`flows/05-dispute-filing.spec.ts`)
- Dispute creation with evidence upload
- Dispute status tracking
- Agent review and resolution
- Dispute escalation
- Comment threads
- Dispute withdrawal

### 6. **Float Transfer** (`flows/06-float-transfer.spec.ts`)
- Agent float balance management
- Float transfers between agents
- Liquidity addition and withdrawal
- Transaction history
- Bulk distribution
- Float reconciliation

### 7. **Settlement** (`flows/07-settlement.spec.ts`)
- Pending settlements dashboard
- Single and batch settlement processing
- Settlement reconciliation
- Discrepancy detection
- Failed settlement retry
- Settlement statistics and reports

### 8. **Complete User Journey** (`flows/08-complete-user-journey.spec.ts`)
- End-to-end integration tests
- Multi-flow user lifecycle
- Agent workflow integration
- Flaky test demonstrations
- Transaction rollback handling

## 🏗️ Architecture

### Page Object Model

All page interactions are abstracted into reusable Page Objects located in `utils/page-objects/`:

- `BasePage.ts` - Common functionality for all pages
- `WalletPage.ts` - Wallet connection/disconnection
- `KycPage.ts` - KYC verification flows
- `LoanPage.ts` - Loan management
- `RemittancePage.ts` - Remittance operations
- `DisputePage.ts` - Dispute handling
- `AgentPage.ts` - Agent dashboard
- `SettlementPage.ts` - Settlement processing

### Test Fixtures

`utils/fixtures.ts` provides:
- Mock user data (borrowers, lenders, agents, admins)
- Test loan generation
- Test remittance generation
- Wallet state creation
- Credit score fixtures
- Database seeding utilities

## 🚀 Running Tests

### Local Development

```bash
# Run all tests
npm run test:e2e

# Run specific flow
npx playwright test flows/01-agent-onboarding-kyc

# Run in headed mode (see browser)
npx playwright test --headed

# Run in specific browser
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit

# Run with UI mode for debugging
npx playwright test --ui

# Run tests matching pattern
npx playwright test --grep "loan"
```

### CI/CD Integration

Tests run automatically on every PR:

```bash
# CI command (defined in package.json)
npm run test:e2e
```

## 🧪 Test Isolation

### Database Seeding

Each test uses isolated mock data:

```typescript
import { TEST_USERS, createMockLoan } from '../utils/fixtures.js';

// Create isolated test data
const loan = createMockLoan({ amount: 1000, status: 'active' });
```

### API Mocking

All API calls are mocked using Playwright's route mocking:

```typescript
await page.route('**/api/loans', async (route) => {
  await route.fulfill({
    status: 200,
    body: JSON.stringify({ success: true, data: mockLoan }),
  });
});
```

## 🏷️ Flaky Test Management

Tests that show intermittent failures are tagged with `@flaky`:

```typescript
test('[@flaky] Cross-browser wallet synchronization', async ({ page }) => {
  // Test implementation
});
```

### Running Flaky Tests Separately

```bash
# Run only flaky tests
npx playwright test --grep "@flaky"

# Exclude flaky tests from main run
npx playwright test --grep-invert "@flaky"
```

### Quarantine Process

1. **Identify**: Tests failing <95% success rate in CI
2. **Tag**: Add `@flaky` tag to test name
3. **Isolate**: Run separately from main suite
4. **Fix**: Debug and stabilize
5. **Restore**: Remove tag once stable

## 📊 Test Reports

After running tests, view the HTML report:

```bash
npx playwright show-report
```

## 🐛 Debugging

### Debug Specific Test

```bash
# Open Playwright Inspector
npx playwright test flows/01-agent-onboarding-kyc --debug

# Use codegen to generate test code
npx playwright codegen http://localhost:3000
```

### Screenshots & Videos

Configure in `playwright.config.ts`:

```typescript
use: {
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
}
```

## ✅ Best Practices

### DO

- ✅ Use Page Objects for reusable interactions
- ✅ Mock all API calls for test isolation
- ✅ Use meaningful test names describing the flow
- ✅ Keep tests independent (no shared state)
- ✅ Tag flaky tests with `@flaky`
- ✅ Use fixtures for test data

### DON'T

- ❌ Rely on external APIs or databases
- ❌ Use hard-coded waits (`page.waitForTimeout`)
- ❌ Share state between tests
- ❌ Test implementation details
- ❌ Duplicate test scenarios across files

## 📝 Adding New Tests

1. **Choose appropriate flow file** or create new one in `flows/`
2. **Create/extend Page Objects** in `utils/page-objects/` if needed
3. **Add fixtures** in `utils/fixtures.ts` for test data
4. **Mock all APIs** using `page.route()`
5. **Write test** using Page Object methods
6. **Update this README** with new coverage

### Example

```typescript
import { test, expect } from '@playwright/test';
import { LoanPage } from '../utils/page-objects/LoanPage.js';
import { TEST_USERS, createWalletState } from '../utils/fixtures.js';

test.describe('My New Flow', () => {
  test('should do something', async ({ page }) => {
    const loanPage = new LoanPage(page);
    
    // Setup
    await page.route('**/api/endpoint', mockHandler);
    
    // Action
    await loanPage.performAction();
    
    // Assert
    await expect(page.locator('text=Success')).toBeVisible();
  });
});
```

## 📋 PR Checklist

When adding E2E tests:

- [ ] Tests follow Page Object Model pattern
- [ ] All API calls are mocked
- [ ] Test data uses fixtures
- [ ] Tests are independent and isolated
- [ ] Flaky tests are tagged with `@flaky`
- [ ] README updated with new coverage
- [ ] Tests pass locally with `npm run test:e2e`

## 🔧 Configuration

### Playwright Config

See `playwright.config.ts` for:
- Browser configurations (Chromium, Firefox, WebKit)
- Retry logic (2 retries in CI)
- Timeouts and navigation settings
- Base URL configuration
- Web server setup

### Environment Variables

```bash
# Base URL (default: http://localhost:3000)
BASE_URL=http://localhost:3000

# CI mode (enables stricter settings)
CI=true
```

## 📚 Resources

- [Playwright Documentation](https://playwright.dev)
- [Page Object Model Pattern](https://playwright.dev/docs/pom)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [DukaPay Contributing Guidelines](../../CONTRIBUTING.md)

## 💬 Support

Join our Telegram community for questions and discussions:
- 💬 Telegram: https://t.me/+eRqhka27TVo0NzM8

All official decisions happen on GitHub. Telegram is for informal discussion and peer support.
