# Load Testing Guide for DukaPay

Complete guide for running, analyzing, and maintaining load tests.

## Table of Contents
- [Getting Started](#getting-started)
- [Test Scenarios](#test-scenarios)
- [Running Tests](#running-tests)
- [Analyzing Results](#analyzing-results)
- [Baseline Management](#baseline-management)
- [Regression Detection](#regression-detection)
- [CI/CD Integration](#cicd-integration)
- [Troubleshooting](#troubleshooting)

## Getting Started

### Prerequisites

1. **Install k6**:
   ```bash
   # macOS
   brew install k6
   
   # Ubuntu/Debian
   sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
   echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
   sudo apt-get update
   sudo apt-get install k6
   
   # Windows
   choco install k6
   ```

2. **Verify Installation**:
   ```bash
   k6 version
   ```

3. **Setup Environment**:
   ```bash
   cd tests/load
   
   # Set environment variables
   export TEST_ENV=staging
   export TEST_AUTH_TOKEN=your-token
   export STAGING_API_URL=https://api.staging.dukapay.io
   ```

## Test Scenarios

### 1. API Read Operations (1000 RPS)

**Purpose**: Test read-heavy endpoints under high load.

**Key Metrics**:
- Target RPS: 1000
- P95 Latency: < 500ms
- P99 Latency: < 1000ms
- Error Rate: < 1%

**Endpoints Tested**:
- Pool stats (30% of traffic)
- Borrower loans (25%)
- Credit scores (20%)
- Remittances (10%)
- Health checks (8%)
- Notifications (5%)
- Version info (2%)

**Run Command**:
```bash
k6 run scenarios/api-read.js
```

### 2. API Write Operations (100 RPS)

**Purpose**: Test write endpoints and data persistence under load.

**Key Metrics**:
- Target RPS: 100
- P95 Latency: < 1000ms
- P99 Latency: < 2000ms
- Error Rate: < 2%

**Operations Tested**:
- Loan creation (40%)
- Repayments (30%)
- Remittances (15%)
- Disputes (10%)
- Profile updates (5%)

**Run Command**:
```bash
k6 run scenarios/api-write.js
```

### 3. Contract Calls (100 TPS)

**Purpose**: Test Stellar Soroban contract interactions.

**Key Metrics**:
- Target TPS: 100
- P95 Latency: < 2000ms
- P99 Latency: < 5000ms
- Error Rate: < 5%

**Operations Tested**:
- Loan approvals (35%)
- Loan funding (25%)
- Pool deposits (20%)
- Pool withdrawals (10%)
- NFT minting (10%)

**Run Command**:
```bash
k6 run scenarios/contract-calls.js
```

### 4. Settlement Batch (1000 loans)

**Purpose**: Test batch settlement processing capabilities.

**Key Metrics**:
- Batch Size: 500-1000 loans
- P95 Latency: < 10000ms
- P99 Latency: < 15000ms
- Error Rate: < 3%
- Minimum Throughput: 50k loans in test duration

**Run Command**:
```bash
k6 run scenarios/settlement-batch.js
```

## Running Tests

### Local Testing

```bash
# Single scenario
k6 run scenarios/api-read.js

# With environment
TEST_ENV=staging k6 run scenarios/api-read.js

# With custom duration
TEST_DURATION=short k6 run scenarios/api-read.js

# With load profile
LOAD_PROFILE=stress k6 run scenarios/api-read.js

# With detailed output
k6 run --out json=results/output.json scenarios/api-read.js
```

### Using npm Scripts

```bash
# Individual tests
npm run test:api-read
npm run test:api-write
npm run test:contract-calls
npm run test:settlement-batch

# All tests
npm run test:all

# Baseline establishment
npm run test:baseline

# Regression check
npm run test:regression

# Generate report
npm run report
```

### Load Profiles

Choose appropriate profile based on testing goals:

**Smoke Test** (Quick validation):
```bash
LOAD_PROFILE=smoke k6 run scenarios/api-read.js
```
- Read: 10 RPS
- Write: 1 RPS
- Contract: 1 TPS
- Duration: ~5 minutes

**Normal** (Target capacity):
```bash
LOAD_PROFILE=normal k6 run scenarios/api-read.js
```
- Read: 1000 RPS
- Write: 100 RPS
- Contract: 100 TPS
- Duration: ~15 minutes

**Stress Test** (Above capacity):
```bash
LOAD_PROFILE=stress k6 run scenarios/api-read.js
```
- Read: 2000 RPS
- Write: 200 RPS
- Contract: 150 TPS
- Duration: ~20 minutes

**Spike Test** (Sudden surge):
```bash
LOAD_PROFILE=spike k6 run scenarios/api-read.js
```
- Read: 5000 RPS
- Write: 500 RPS
- Contract: 200 TPS
- Duration: ~10 minutes

## Analyzing Results

### Understanding k6 Output

k6 provides real-time metrics during test execution:

```
     ✓ status is 200
     ✓ response time < 1000ms
     
     checks.........................: 100.00% ✓ 48523     ✗ 0      
     data_received..................: 145 MB  2.4 MB/s
     data_sent......................: 4.9 MB  82 kB/s
     http_req_duration..............: avg=245.6ms p(95)=423.8ms p(99)=856.2ms
     http_reqs......................: 48523   952.3/s
     vus............................: 1000    min=0       max=1000
```

### Key Metrics Explained

**http_req_duration**: Request latency
- `avg`: Average latency
- `p(95)`: 95th percentile (95% of requests faster)
- `p(99)`: 99th percentile
- `max`: Maximum latency

**http_reqs**: Total requests and rate
- Count: Total requests executed
- Rate: Requests per second

**http_req_failed**: Error rate
- Percentage of failed requests

**checks**: Assertion pass rate
- Percentage of successful checks

### Result Files

After each test run:

```bash
results/
├── api-read-summary.json       # Structured metrics
├── api-write-summary.json
├── contract-calls-summary.json
├── settlement-batch-summary.json
├── regression-report.json      # Regression analysis
└── load-test-report.html       # Visual report
```

### Viewing HTML Report

```bash
npm run report
open results/load-test-report.html
```

## Baseline Management

### Establishing Baselines

Baselines should be established after:
- Major releases
- Infrastructure changes
- Scaling operations
- Optimization efforts

**Run baseline script**:
```bash
npm run test:baseline
```

This will:
1. Run all 4 scenarios sequentially
2. Save results to `results/`
3. Copy to `baselines/` as baseline files
4. Generate summary report

### Baseline Files

```bash
baselines/
├── api-read-baseline.json
├── api-write-baseline.json
├── contract-calls-baseline.json
└── settlement-batch-baseline.json
```

Each baseline includes:
```json
{
  "timestamp": "2026-08-28T02:00:00.000Z",
  "metrics": {
    "requests_per_second": 952.3,
    "latency_p95": 423.8,
    "latency_p99": 856.2,
    "error_rate": 0.0045
  },
  "baseline_created_at": "2026-08-28T02:30:00.000Z",
  "baseline_version": "a1b2c3d4e5f6",
  "baseline_environment": "staging"
}
```

### Updating Baselines

Baselines should be updated when:
- Performance improves significantly
- Infrastructure is upgraded
- Optimization changes are deployed
- Current baseline is outdated (>30 days)

**Update process**:
```bash
# 1. Run new baseline
npm run test:baseline

# 2. Review results
npm run test:regression

# 3. If acceptable, commit new baselines
git add baselines/
git commit -m "chore: update load test baselines"
```

## Regression Detection

### Running Regression Checks

```bash
npm run test:regression
```

### Regression Criteria

A regression is detected when:
- **Latency (P95/P99)**: Increases by > 20%
- **Error Rate**: Increases by > 20%
- **Throughput**: Decreases by > 20%

### Regression Report

```json
{
  "timestamp": "2026-08-28T10:00:00.000Z",
  "threshold": 0.20,
  "scenarios": [
    {
      "scenario": "api-read",
      "checks": [
        {
          "metric": "Latency (p95)",
          "baseline": 423.8,
          "current": 512.5,
          "percentChange": 20.9,
          "isRegression": true
        }
      ],
      "hasRegression": true
    }
  ],
  "summary": {
    "total_scenarios": 4,
    "scenarios_with_regressions": 1,
    "total_regressions": 2
  }
}
```

### Handling Regressions

When regressions are detected:

1. **Review the report**:
   ```bash
   cat results/regression-report.json
   ```

2. **Identify affected endpoints**:
   - Check specific operations
   - Look at error messages
   - Review latency patterns

3. **Investigate root cause**:
   - Check recent deployments
   - Review database queries
   - Monitor resource usage
   - Check rate limiting

4. **Take action**:
   - Rollback if critical
   - Optimize code/queries
   - Scale infrastructure
   - Adjust rate limits

## CI/CD Integration

### Automatic Nightly Runs

Tests run automatically every night at 2 AM UTC:
- All 4 scenarios executed
- Results compared to baselines
- Regressions trigger alerts
- Reports uploaded as artifacts

### GitHub Actions Workflow

Located at `.github/workflows/load-tests.yml`

**Triggers**:
- Schedule: Daily at 2 AM UTC
- Manual: Via workflow_dispatch

**Artifacts**:
- Test results (90 days retention)
- Baselines (365 days retention)

### Manual CI Runs

1. Go to GitHub Actions
2. Select "Load Tests"
3. Click "Run workflow"
4. Choose:
   - Environment: `staging` or `production`
   - Load profile: `smoke`, `normal`, `stress`, `spike`
5. Run

### Viewing CI Results

1. Go to Actions tab
2. Click on load test run
3. Download artifacts:
   - `load-test-results-{run_number}`
   - `load-test-baselines`

## Troubleshooting

### Common Issues

#### 1. High Error Rates

**Symptoms**: Error rate > threshold

**Possible Causes**:
- API unavailable
- Rate limiting
- Authentication issues
- Database connection errors

**Solutions**:
```bash
# Check API health
curl https://api.staging.dukapay.io/health

# Verify auth token
echo $TEST_AUTH_TOKEN

# Check rate limits
curl -I https://api.staging.dukapay.io/api/v1/pool/stats

# Review API logs
kubectl logs -n dukapay deployment/api --tail=100
```

#### 2. High Latency

**Symptoms**: P95/P99 exceeds thresholds

**Possible Causes**:
- Database slow queries
- Insufficient resources
- Network congestion
- External service delays

**Solutions**:
```bash
# Check resource usage
kubectl top pods -n dukapay

# Review slow queries
# Connect to database and check slow query log

# Check network latency
ping api.staging.dukapay.io

# Scale up if needed
kubectl scale deployment/api --replicas=5
```

#### 3. Connection Errors

**Symptoms**: "Connection refused" or "Timeout"

**Possible Causes**:
- API not running
- Wrong URL
- Firewall blocking
- Network issues

**Solutions**:
```bash
# Verify API URL
echo $STAGING_API_URL

# Test connectivity
curl -v https://api.staging.dukapay.io

# Check DNS
nslookup api.staging.dukapay.io

# Verify firewall rules
```

#### 4. k6 Crashes

**Symptoms**: k6 process terminates unexpectedly

**Possible Causes**:
- Out of memory
- Too many VUs
- Script errors

**Solutions**:
```bash
# Reduce VUs
LOAD_PROFILE=smoke k6 run scenarios/api-read.js

# Check script syntax
k6 run --no-color scenarios/api-read.js

# Monitor memory
k6 run --out json=output.json scenarios/api-read.js
```

### Debugging Tips

**Enable verbose logging**:
```bash
k6 run --verbose scenarios/api-read.js
```

**Output to JSON**:
```bash
k6 run --out json=output.json scenarios/api-read.js
```

**Run with fewer VUs**:
```bash
k6 run --vus 10 --duration 30s scenarios/api-read.js
```

**Test single endpoint**:
```javascript
// Modify scenario to test one endpoint
export default function () {
  const response = http.get('https://api.staging.dukapay.io/health');
  console.log(response.status, response.body);
  sleep(1);
}
```

## Best Practices

### DO ✅

- Run smoke tests before full load tests
- Establish baselines after major changes
- Monitor trends over time
- Test against staging first
- Use realistic data
- Clean up test data
- Document test results
- Review regressions promptly
- Update baselines regularly
- Run tests during off-peak hours

### DON'T ❌

- Run stress tests against production without approval
- Hardcode sensitive data
- Ignore warning signals
- Skip baseline establishment
- Mix test and production environments
- Run tests during business hours (production)
- Commit test results to git
- Use production API keys in tests
- Ignore failed tests
- Run multiple tests simultaneously

## Performance Targets

### API Read Operations
- **Target**: 1000 RPS sustained
- **P95 Latency**: < 500ms
- **P99 Latency**: < 1000ms
- **Error Rate**: < 1%
- **Availability**: > 99.9%

### API Write Operations
- **Target**: 100 RPS sustained
- **P95 Latency**: < 1000ms
- **P99 Latency**: < 2000ms
- **Error Rate**: < 2%
- **Data Consistency**: 100%

### Contract Calls
- **Target**: 100 TPS sustained
- **P95 Latency**: < 2000ms
- **P99 Latency**: < 5000ms
- **Error Rate**: < 5%
- **Transaction Success**: > 95%

### Settlement Batch
- **Target**: 1000 loans per batch
- **Batch Latency**: < 10s (P95)
- **Error Rate**: < 3%
- **Throughput**: > 50k loans per test run

## Support

For questions or issues:
- **GitHub Issues**: Report bugs
- **Telegram**: https://t.me/+eRqhka27TVo0NzM8
- **Email**: ops@dukapay.io
- **Documentation**: https://docs.dukapay.io
