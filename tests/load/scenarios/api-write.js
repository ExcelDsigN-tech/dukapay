/**
 * Load Test: API Write Operations (100 RPS target)
 * Tests write endpoints like loan applications, repayments, disputes
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { getConfig } from '../utils/config.js';
import { generateAuthToken, generateTestUser } from '../utils/auth.js';
import { generateLoanRequest, generateRepayment, generateDispute } from '../utils/generators.js';

// Custom metrics
const errorRate = new Rate('errors');
const successRate = new Rate('success');
const writeLatency = new Trend('write_latency');
const loanCreated = new Counter('loans_created');
const repaymentsProcessed = new Counter('repayments_processed');

export const options = {
  stages: [
    { duration: '1m', target: 10 },     // Warm up
    { duration: '3m', target: 50 },     // Ramp to 50 RPS
    { duration: '5m', target: 100 },    // Target: 100 RPS
    { duration: '5m', target: 100 },    // Sustain
    { duration: '1m', target: 0 },      // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<1000', 'p(99)<2000'],  // Writes can be slower
    'http_req_failed': ['rate<0.02'],                   // Error rate < 2%
    'errors': ['rate<0.02'],
    'success': ['rate>0.98'],
  },
  tags: {
    test_type: 'api-write',
    environment: __ENV.TEST_ENV || 'staging',
  },
};

const config = getConfig();

export function setup() {
  console.log('Setting up API Write load test...');
  return {
    baseUrl: config.baseUrl,
    authToken: generateAuthToken(),
  };
}

export default function (data) {
  const { baseUrl, authToken } = data;
  const testUser = generateTestUser();
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
    'Idempotency-Key': `load-test-${__VU}-${__ITER}-${Date.now()}`,
  };

  // Write operation distribution
  const operations = [
    {
      weight: 0.4,
      name: 'create_loan',
      execute: () => {
        const loanData = generateLoanRequest(testUser);
        const response = http.post(
          `${baseUrl}/api/v1/loans`,
          JSON.stringify(loanData),
          { headers, tags: { operation: 'create_loan' } }
        );
        
        const success = check(response, {
          'loan created': (r) => r.status === 200 || r.status === 201,
          'has loan ID': (r) => {
            try {
              const body = JSON.parse(r.body);
              return body.data && body.data.id;
            } catch {
              return false;
            }
          },
        });
        
        if (success) loanCreated.add(1);
        return response;
      },
    },
    {
      weight: 0.3,
      name: 'process_repayment',
      execute: () => {
        const loanId = Math.floor(Math.random() * 1000) + 1;
        const repaymentData = generateRepayment();
        const response = http.post(
          `${baseUrl}/api/v1/loans/${loanId}/repay`,
          JSON.stringify(repaymentData),
          { headers, tags: { operation: 'process_repayment' } }
        );
        
        // 404 is acceptable here (loan might not exist in load test)
        const success = check(response, {
          'repayment processed': (r) => r.status === 200 || r.status === 404,
        });
        
        if (response.status === 200) repaymentsProcessed.add(1);
        return response;
      },
    },
    {
      weight: 0.15,
      name: 'create_remittance',
      execute: () => {
        const remittanceData = {
          recipientAddress: 'GA' + 'A'.repeat(54),
          amount: Math.floor(Math.random() * 1000) + 100,
          fromCurrency: 'USDC',
          toCurrency: 'NGN',
        };
        
        const response = http.post(
          `${baseUrl}/api/v1/remittances`,
          JSON.stringify(remittanceData),
          { headers, tags: { operation: 'create_remittance' } }
        );
        
        return response;
      },
    },
    {
      weight: 0.1,
      name: 'file_dispute',
      execute: () => {
        const loanId = Math.floor(Math.random() * 1000) + 1;
        const disputeData = generateDispute();
        const response = http.post(
          `${baseUrl}/api/v1/loans/${loanId}/dispute`,
          JSON.stringify(disputeData),
          { headers, tags: { operation: 'file_dispute' } }
        );
        
        return response;
      },
    },
    {
      weight: 0.05,
      name: 'update_profile',
      execute: () => {
        const profileData = {
          displayName: `LoadTest User ${__VU}`,
          notificationPreferences: {
            email: true,
            sms: false,
          },
        };
        
        const response = http.put(
          `${baseUrl}/user/profile`,
          JSON.stringify(profileData),
          { headers, tags: { operation: 'update_profile' } }
        );
        
        return response;
      },
    },
  ];

  // Select operation based on weight
  const rand = Math.random();
  let cumWeight = 0;
  let selectedOp;
  
  for (const op of operations) {
    cumWeight += op.weight;
    if (rand < cumWeight) {
      selectedOp = op;
      break;
    }
  }

  const startTime = Date.now();
  const response = selectedOp.execute();
  const duration = Date.now() - startTime;

  writeLatency.add(duration, { operation: selectedOp.name });

  const success = check(response, {
    'status in success range': (r) => r.status >= 200 && r.status < 300,
    'response time < 2000ms': (r) => r.timings.duration < 2000,
  });

  if (success) {
    successRate.add(1);
  } else {
    errorRate.add(1);
    if (response.status >= 500) {
      console.error(`Server error in ${selectedOp.name}: ${response.status} - ${response.body.substring(0, 100)}`);
    }
  }

  // Write operations need more time between requests
  sleep(0.5);
}

export function teardown(data) {
  console.log('API Write load test completed');
}

export function handleSummary(data) {
  const timestamp = new Date().toISOString();
  
  return {
    'results/api-write-summary.json': JSON.stringify({
      timestamp,
      test: 'api-write',
      environment: options.tags.environment,
      metrics: {
        requests_total: data.metrics.http_reqs.values.count,
        requests_per_second: data.metrics.http_reqs.values.rate,
        error_rate: data.metrics.errors?.values.rate || 0,
        loans_created: data.metrics.loans_created?.values.count || 0,
        repayments_processed: data.metrics.repayments_processed?.values.count || 0,
        latency_p95: data.metrics.http_req_duration.values['p(95)'],
        latency_p99: data.metrics.http_req_duration.values['p(99)'],
        latency_avg: data.metrics.http_req_duration.values.avg,
        latency_max: data.metrics.http_req_duration.values.max,
      },
      thresholds: data.metrics,
    }, null, 2),
    'stdout': JSON.stringify(data, null, 2),
  };
}
