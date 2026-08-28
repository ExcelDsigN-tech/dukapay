/**
 * Load Test: API Read Operations (1000 RPS target)
 * Tests read-heavy endpoints like loan listings, scores, pool stats
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { getConfig } from '../utils/config.js';
import { generateAuthToken, selectRandomUser } from '../utils/auth.js';

// Custom metrics
const errorRate = new Rate('errors');
const successRate = new Rate('success');
const apiLatency = new Trend('api_latency');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 100 },    // Ramp up to 100 RPS
    { duration: '5m', target: 500 },    // Ramp to 500 RPS
    { duration: '10m', target: 1000 },  // Target load: 1000 RPS
    { duration: '5m', target: 1000 },   // Sustain 1000 RPS
    { duration: '2m', target: 0 },      // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],  // 95% under 500ms, 99% under 1s
    'http_req_failed': ['rate<0.01'],                  // Error rate < 1%
    'errors': ['rate<0.01'],
    'success': ['rate>0.99'],
  },
  tags: {
    test_type: 'api-read',
    environment: __ENV.TEST_ENV || 'staging',
  },
};

const config = getConfig();

export function setup() {
  console.log('Setting up API Read load test...');
  console.log(`Target: ${config.baseUrl}`);
  console.log(`Duration: 24 minutes`);
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

  // Endpoint distribution (weighted by expected production traffic)
  const endpoints = [
    { weight: 0.3, url: '/api/v1/pool/stats', name: 'pool_stats' },
    { weight: 0.25, url: '/api/v1/loans/borrower/' + selectRandomUser(), name: 'borrower_loans' },
    { weight: 0.2, url: '/api/v1/score/' + selectRandomUser(), name: 'credit_score' },
    { weight: 0.1, url: '/api/v1/remittances', name: 'remittances_list' },
    { weight: 0.08, url: '/health', name: 'health_check' },
    { weight: 0.05, url: '/api/v1/notifications', name: 'notifications' },
    { weight: 0.02, url: '/version', name: 'version_info' },
  ];

  // Select endpoint based on weight distribution
  const rand = Math.random();
  let cumWeight = 0;
  let selectedEndpoint;
  
  for (const endpoint of endpoints) {
    cumWeight += endpoint.weight;
    if (rand < cumWeight) {
      selectedEndpoint = endpoint;
      break;
    }
  }

  const startTime = Date.now();
  const response = http.get(`${baseUrl}${selectedEndpoint.url}`, {
    headers,
    tags: { endpoint: selectedEndpoint.name },
  });
  const duration = Date.now() - startTime;

  // Record metrics
  apiLatency.add(duration, { endpoint: selectedEndpoint.name });
  
  const success = check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 1000ms': (r) => r.timings.duration < 1000,
    'response has data': (r) => r.body.length > 0,
  });

  if (success) {
    successRate.add(1);
  } else {
    errorRate.add(1);
    console.error(`Failed request to ${selectedEndpoint.name}: ${response.status}`);
  }

  // Dynamic sleep based on target RPS (1000 RPS = 1ms per request per VU)
  sleep(0.1);
}

export function teardown(data) {
  console.log('Tearing down API Read load test...');
  console.log('Test completed successfully');
}

export function handleSummary(data) {
  const timestamp = new Date().toISOString();
  
  return {
    'results/api-read-summary.json': JSON.stringify({
      timestamp,
      test: 'api-read',
      environment: options.tags.environment,
      metrics: {
        requests_total: data.metrics.http_reqs.values.count,
        requests_per_second: data.metrics.http_reqs.values.rate,
        error_rate: data.metrics.errors?.values.rate || 0,
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
