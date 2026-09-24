# DukaPay Load Testing Suite

Comprehensive load testing framework using k6 to establish performance baselines and detect regressions for API endpoints and Stellar Soroban contract calls.

## 🎯 Overview

This suite provides automated load testing for:
- **API Read Operations**: 1000 RPS target
- **API Write Operations**: 100 RPS target  
- **Contract Calls**: 100 TPS target
- **Settlement Batch Processing**: 1000 loans per batch

## 📋 Test Scenarios

### 1. API Read (1000 RPS)
**File**: `scenarios/api-read.js`

Tests read-heavy endpoints with realistic traffic distribution:
- Pool stats (30%)
- Borrower loans (25%)
- Credit scores (20%)
- Remittances (10%)
- Health checks (8%)
- Notifications (5%)
- Version info (2%)

**Thresholds**:
- P95 latency < 500ms
- P99 latency < 1000ms
- Error rate < 1%

### 2. API Write (100 RPS)
**File**: `scenarios/api-write.js`

Tests write endpoints:
- Loan creation (40%)
- Repayments (30%)
- Remittances (15%)
- Disputes (10%)
- Profile updates (5%)

**Thresholds**:
- P95 latency < 1000ms
- P99 latency < 2000ms
- Error rate < 2%

### 3. Contract Calls (100 TPS)
**File**: `scenarios/contract-calls.js`

Tests Stellar Soroban contract interactions:
- Loan approvals (35%)
- Loan funding (25%)
- Pool deposits (20%)
- Pool withdrawals (10%)
- NFT minting (10%)

**Thresholds**:
- P95 latency < 2000ms
- P99 latency < 5000ms
- Error rate < 5%

### 4. Settlement Batch (1000 loans)
**File**: `scenarios/settlement-batch.js`

Tests batch settlement processing:
- Fetch pending settlements
- Process batches of 500-1000 loans
- Check batch status
- Retrieve statistics

**Thresholds**:
- P95 latency < 10000ms
- P99 latency < 15000ms
- Error rate < 3%
- Minimum 50k loans processed

## 🚀 Quick Start

### Prerequisites

```bash
# Install k6
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Windows
choco install k6

# Verify installation
k6 version
```

### Running Tests

```bash
cd tests/load

# Run individual scenario
k6 run scenarios/api-read.js

# Run with environment
TEST_ENV=staging k6 run scenarios/api-read.js

# Run all scenarios
npm run test:all

# Run baseline establishment
npm run test:baseline

# Check for regressions
npm run test:regression

# Generate report
npm run report
```

## 📊 Baseline Management

### Establishing Baselines

Run the baseline script to execute all scenarios and save results:

```bash
npm run test:baseline
```

This will:
1. Run all 4 load test scenarios
2. Save results to `results/` directory
3. Copy results to `baselines/` directory
4. Generate summary report

Baselines are stored in `baselines/` with the format:
```
baselines/
├── api-read-baseline.json
├── api-write-baseline.json
├── contract-calls-baseline.json
└── settlement-batch-baseline.json
```

### Regression Detection

Check for performance regressions:

```bash
npm run test:regression
```

**Regression Criteria**:
- Latency increase > 20%
- Error rate increase > 20%
- Throughput decrease > 20%

The script will:
- Compare current results to baselines
- Identify regressions
- Generate regression report
- Exit with code 1 if regressions found

## 🔧 Configuration

### Environment Variables

```bash
# Test environment
TEST_ENV=staging|production

# Load profile
LOAD_PROFILE=smoke|normal|stress|spike

# API URLs
STAGING_API_URL=https://api.staging.dukapay.io
PROD_API_URL=https://api.dukapay.io

# Authentication
TEST_AUTH_TOKEN=your-test-token
TEST_API_KEY=your-api-key

# Test duration
TEST_DURATION=short|medium|long
```

### Load Profiles

```javascript
{
  smoke: { read: 10, write: 1, contract: 1 },      // Quick validation
  normal: { read: 1000, write: 100, contract: 100 }, // Target load
  stress: { read: 2000, write: 200, contract: 150 }, // Above capacity
  spike: { read: 5000, write: 500, contract: 200 },  // Sudden surge
}
```

## 📈 Results & Reporting

### Results Structure

```json
{
  "timestamp": "2026-08-28T10:00:00Z",
  "test": "api-read",
  "environment": "staging",
  "metrics": {
    "requests_total": 50000,
    "requests_per_second": 950.5,
    "error_rate": 0.005,
    "latency_p95": 450.2,
    "latency_p99": 890.5,
    "latency_avg": 250.3,
    "latency_max": 1500.8
  },
  "thresholds_passed": true
}
```

### Viewing Reports

```bash
# Generate HTML report
npm run report

# Open report in browser
open results/load-test-report.html
```

## 🔄 CI/CD Integration

### Nightly Runs

Load tests run automatically every night at 2 AM UTC via GitHub Actions (`.github/workflows/load-tests.yml`).

**Workflow steps**:
1. Install k6
2. Download existing baselines
3. Run all 4 scenarios
4. Check for regressions (20% threshold)
5. Generate reports
6. Upload artifacts
7. Send alerts if regressions detected
8. Create GitHub issue for regressions

### Manual Triggers

Run tests manually via GitHub Actions:
1. Go to Actions tab
2. Select "Load Tests" workflow
3. Click "Run workflow"
4. Select environment and load profile
5. Click "Run workflow"

### Artifacts

Test results are saved as artifacts:
- **load-test-results-{run_number}**: Current test results (90 days)
- **load-test-baselines**: Baseline data (365 days)

## 🚨 Alerting

### Regression Alerts

When regressions are detected (>20% degradation):

1. **GitHub Issue Created**:
   - Title: `[Performance] Load Test Regression Detected`
   - Labels: `performance`, `regression`, `priority:high`
   - Body includes affected scenarios and metrics

2. **Slack Notification** (if configured):
   - Sent to performance channel
   - Includes environment, profile, and link to results

3. **Email Notification** (if configured):
   - Sent to ops team
   - Includes regression summary

### Alert Configuration

Set these secrets in GitHub Actions:
```bash
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
LOAD_TEST_AUTH_TOKEN=your-test-token
STAGING_API_URL=https://api.staging.dukapay.io
```

## 📝 Writing Custom Scenarios

### Basic Structure

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { getConfig } from '../utils/config.js';

const errorRate = new Rate('errors');
const latency = new Trend('latency');

export const options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    'http_req_duration': ['p(95)<1000'],
    'errors': ['rate<0.01'],
  },
};

export default function () {
  const config = getConfig();
  const response = http.get(`${config.baseUrl}/api/endpoint`);
  
  const success = check(response, {
    'status is 200': (r) => r.status === 200,
  });
  
  if (success) {
    latency.add(response.timings.duration);
  } else {
    errorRate.add(1);
  }
  
  sleep(1);
}
```

## 🐛 Troubleshooting

### Common Issues

**k6 not found**:
```bash
# Install k6 first
brew install k6  # macOS
```

**Authentication errors**:
```bash
# Set test token
export TEST_AUTH_TOKEN=your-token
```

**Connection refused**:
```bash
# Verify API is running
curl http://localhost:4000/health
```

**High error rates**:
- Check API logs
- Verify database connections
- Check rate limiting settings
- Ensure test data is properly seeded

## 📚 Best Practices

### DO ✅
- Run baseline tests after major releases
- Monitor trends over time
- Test against staging before production
- Use realistic load profiles
- Include think time between requests
- Clean up test data after runs

### DON'T ❌
- Run stress tests against production
- Hardcode authentication tokens
- Ignore warning thresholds
- Skip baseline establishment
- Mix test and production data
- Run tests during business hours (production)

## 🔗 Resources

- [k6 Documentation](https://k6.io/docs/)
- [Load Testing Best Practices](https://k6.io/docs/test-types/load-testing)
- [Stellar Soroban Docs](https://soroban.stellar.org/docs)
- [DukaPay API Docs](https://api.dukapay.io/docs)

## 📞 Support

For questions or issues:
- GitHub Issues: Report bugs or request features
- Telegram: https://t.me/+eRqhka27TVo0NzM8
- Email: ops@dukapay.io

## 📄 License

MIT License - See LICENSE file for details
