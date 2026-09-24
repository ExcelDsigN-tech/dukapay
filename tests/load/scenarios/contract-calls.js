/**
 * Load Test: Contract Calls (100 TPS target)
 * Tests Stellar Soroban contract interactions
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { getConfig } from '../utils/config.js';
import { generateAuthToken } from '../utils/auth.js';
import { generateContractCall } from '../utils/generators.js';

// Custom metrics
const errorRate = new Rate('contract_errors');
const successRate = new Rate('contract_success');
const contractLatency = new Trend('contract_latency');
const transactionsSubmitted = new Counter('transactions_submitted');
const transactionsFailed = new Counter('transactions_failed');

export const options = {
  stages: [
    { duration: '2m', target: 20 },     // Warm up
    { duration: '3m', target: 50 },     // Ramp to 50 TPS
    { duration: '5m', target: 100 },    // Target: 100 TPS
    { duration: '10m', target: 100 },   // Sustain 100 TPS
    { duration: '2m', target: 0 },      // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<2000', 'p(99)<5000'],  // Contract calls slower
    'contract_errors': ['rate<0.05'],                   // Error rate < 5%
    'contract_success': ['rate>0.95'],
  },
  tags: {
    test_type: 'contract-calls',
    environment: __ENV.TEST_ENV || 'staging',
  },
};

const config = getConfig();

export function setup() {
  console.log('Setting up Contract Calls load test...');
  console.log('Testing Soroban contract interactions');
  
  return {
    baseUrl: config.baseUrl,
    authToken: generateAuthToken(),
  };
}

export default function (data) {
  const { baseUrl, authToken } = data;
  
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
  };

  // Contract operation distribution
  const contractOps = [
    {
      weight: 0.35,
      name: 'loan_approve',
      endpoint: '/api/v1/loans/__LOAN_ID__/approve',
      method: 'POST',
      generateData: () => ({
        approverComment: 'Load test approval',
      }),
    },
    {
      weight: 0.25,
      name: 'loan_fund',
      endpoint: '/api/v1/loans/__LOAN_ID__/fund',
      method: 'POST',
      generateData: () => ({}),
    },
    {
      weight: 0.2,
      name: 'pool_deposit',
      endpoint: '/api/v1/pool/deposit',
      method: 'POST',
      generateData: () => ({
        amount: Math.floor(Math.random() * 10000) + 1000,
        asset: 'USDC',
      }),
    },
    {
      weight: 0.1,
      name: 'pool_withdraw',
      endpoint: '/api/v1/pool/withdraw',
      method: 'POST',
      generateData: () => ({
        amount: Math.floor(Math.random() * 5000) + 500,
        asset: 'USDC',
      }),
    },
    {
      weight: 0.1,
      name: 'remittance_mint',
      endpoint: '/api/v1/remittances/__REMITTANCE_ID__/mint-nft',
      method: 'POST',
      generateData: () => ({}),
    },
  ];

  // Select operation
  const rand = Math.random();
  let cumWeight = 0;
  let selectedOp;
  
  for (const op of contractOps) {
    cumWeight += op.weight;
    if (rand < cumWeight) {
      selectedOp = op;
      break;
    }
  }

  // Replace placeholder IDs
  let endpoint = selectedOp.endpoint;
  endpoint = endpoint.replace('__LOAN_ID__', Math.floor(Math.random() * 1000) + 1);
  endpoint = endpoint.replace('__REMITTANCE_ID__', `rem_${Math.random().toString(36).substr(2, 9)}`);

  const requestData = selectedOp.generateData();
  const startTime = Date.now();
  
  let response;
  if (selectedOp.method === 'POST') {
    response = http.post(
      `${baseUrl}${endpoint}`,
      JSON.stringify(requestData),
      { 
        headers,
        tags: { 
          contract_operation: selectedOp.name,
          operation_type: 'contract_call',
        },
        timeout: '10s',  // Contract calls may take longer
      }
    );
  } else {
    response = http.get(
      `${baseUrl}${endpoint}`,
      { 
        headers,
        tags: { contract_operation: selectedOp.name },
      }
    );
  }

  const duration = Date.now() - startTime;
  contractLatency.add(duration, { operation: selectedOp.name });

  // Check transaction submission
  const success = check(response, {
    'status in valid range': (r) => r.status >= 200 && r.status < 500,
    'has transaction hash': (r) => {
      if (r.status >= 200 && r.status < 300) {
        try {
          const body = JSON.parse(r.body);
          return body.txHash || body.data?.txHash;
        } catch {
          return false;
        }
      }
      return true;  // OK for non-2xx statuses
    },
    'response time acceptable': (r) => r.timings.duration < 10000,
  });

  if (response.status >= 200 && response.status < 300) {
    successRate.add(1);
    transactionsSubmitted.add(1);
  } else if (response.status >= 400) {
    errorRate.add(1);
    if (response.status >= 500) {
      transactionsFailed.add(1);
      console.error(`Contract call failed: ${selectedOp.name} - ${response.status}`);
    }
  }

  // Contract calls need more spacing
  sleep(1);
}

export function teardown(data) {
  console.log('Contract Calls load test completed');
}

export function handleSummary(data) {
  const timestamp = new Date().toISOString();
  
  return {
    'results/contract-calls-summary.json': JSON.stringify({
      timestamp,
      test: 'contract-calls',
      environment: options.tags.environment,
      metrics: {
        transactions_total: data.metrics.transactions_submitted?.values.count || 0,
        transactions_per_second: data.metrics.http_reqs.values.rate,
        transactions_failed: data.metrics.transactions_failed?.values.count || 0,
        error_rate: data.metrics.contract_errors?.values.rate || 0,
        success_rate: data.metrics.contract_success?.values.rate || 0,
        latency_p95: data.metrics.http_req_duration.values['p(95)'],
        latency_p99: data.metrics.http_req_duration.values['p(99)'],
        latency_avg: data.metrics.http_req_duration.values.avg,
        latency_max: data.metrics.http_req_duration.values.max,
      },
      thresholds_passed: Object.entries(data.thresholds || {}).every(([_, v]) => v.ok),
    }, null, 2),
    'stdout': JSON.stringify(data, null, 2),
  };
}
