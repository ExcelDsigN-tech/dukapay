/**
 * Load Test: Settlement Batch Processing (1000 loans)
 * Tests batch settlement operations for remittances
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { getConfig } from '../utils/config.js';
import { generateAuthToken } from '../utils/auth.js';

// Custom metrics
const batchErrorRate = new Rate('batch_errors');
const batchSuccessRate = new Rate('batch_success');
const batchLatency = new Trend('batch_latency');
const loansProcessed = new Counter('loans_processed');
const batchSize = new Gauge('batch_size');
const throughput = new Trend('settlement_throughput');

export const options = {
  scenarios: {
    settlement_batch: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '1m', target: 5 },      // Warm up
        { duration: '5m', target: 10 },     // Process batches
        { duration: '10m', target: 20 },    // Peak load
        { duration: '2m', target: 0 },      // Ramp down
      ],
    },
  },
  thresholds: {
    'batch_latency': ['p(95)<10000', 'p(99)<15000'],  // Batch can take longer
    'batch_errors': ['rate<0.03'],
    'batch_success': ['rate>0.97'],
    'loans_processed': ['count>50000'],  // At least 50k loans in test duration
  },
  tags: {
    test_type: 'settlement-batch',
    environment: __ENV.TEST_ENV || 'staging',
  },
};

const config = getConfig();

export function setup() {
  console.log('Setting up Settlement Batch load test...');
  console.log('Target: Process 1000 loans per batch');
  
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

  group('Batch Settlement Flow', () => {
    // Step 1: Get pending settlements
    group('Fetch Pending Settlements', () => {
      const response = http.get(
        `${baseUrl}/api/v1/settlements?status=pending&limit=1000`,
        { 
          headers,
          tags: { operation: 'fetch_pending' },
        }
      );

      check(response, {
        'settlements fetched': (r) => r.status === 200,
        'has settlement data': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.data && Array.isArray(body.data.settlements);
          } catch {
            return false;
          }
        },
      });
    });

    sleep(1);

    // Step 2: Process batch settlement
    group('Process Batch Settlement', () => {
      // Generate batch of settlement IDs
      const batchSizeValue = Math.min(Math.floor(Math.random() * 500) + 500, 1000);
      const settlementIds = [];
      
      for (let i = 0; i < batchSizeValue; i++) {
        settlementIds.push(`settle_${Math.random().toString(36).substr(2, 9)}`);
      }

      const batchData = {
        settlementIds,
        batchId: `batch_${Date.now()}_${__VU}`,
        priority: 'normal',
      };

      batchSize.add(batchSizeValue);

      const startTime = Date.now();
      const response = http.post(
        `${baseUrl}/api/v1/settlements/batch`,
        JSON.stringify(batchData),
        {
          headers: {
            ...headers,
            'Idempotency-Key': batchData.batchId,
          },
          tags: { 
            operation: 'batch_settlement',
            batch_size: batchSizeValue,
          },
          timeout: '30s',  // Batch operations take time
        }
      );

      const duration = Date.now() - startTime;
      batchLatency.add(duration);

      const success = check(response, {
        'batch accepted': (r) => r.status === 200 || r.status === 202,
        'has batch ID': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.data && body.data.batchId;
          } catch {
            return false;
          }
        },
        'processing time reasonable': (r) => r.timings.duration < 30000,
      });

      if (success) {
        batchSuccessRate.add(1);
        loansProcessed.add(batchSizeValue);
        
        // Calculate throughput (loans per second)
        const loansPerSecond = batchSizeValue / (duration / 1000);
        throughput.add(loansPerSecond);
        
        try {
          const body = JSON.parse(response.body);
          if (body.data && body.data.processed) {
            loansProcessed.add(body.data.processed);
          }
        } catch (e) {
          // Ignore parsing errors
        }
      } else {
        batchErrorRate.add(1);
        console.error(`Batch settlement failed: ${response.status} - ${response.body.substring(0, 200)}`);
      }
    });

    sleep(2);

    // Step 3: Check batch status
    group('Check Batch Status', () => {
      const batchId = `batch_${Date.now()}_${__VU}`;
      const response = http.get(
        `${baseUrl}/api/v1/settlements/batch/${batchId}/status`,
        {
          headers,
          tags: { operation: 'batch_status' },
        }
      );

      check(response, {
        'status retrieved': (r) => r.status === 200 || r.status === 404,
      });
    });

    sleep(1);

    // Step 4: Get settlement statistics
    group('Get Settlement Stats', () => {
      const response = http.get(
        `${baseUrl}/api/v1/settlements/stats`,
        {
          headers,
          tags: { operation: 'settlement_stats' },
        }
      );

      check(response, {
        'stats retrieved': (r) => r.status === 200,
        'has metrics': (r) => {
          try {
            const body = JSON.parse(r.body);
            return body.data && typeof body.data.today === 'object';
          } catch {
            return false;
          }
        },
      });
    });
  });

  // Pause between batch iterations
  sleep(5);
}

export function teardown(data) {
  console.log('Settlement Batch load test completed');
}

export function handleSummary(data) {
  const timestamp = new Date().toISOString();
  
  const totalLoans = data.metrics.loans_processed?.values.count || 0;
  const testDuration = (data.state.testRunDurationMs || 0) / 1000;
  const avgThroughput = testDuration > 0 ? totalLoans / testDuration : 0;
  
  return {
    'results/settlement-batch-summary.json': JSON.stringify({
      timestamp,
      test: 'settlement-batch',
      environment: options.tags.environment,
      metrics: {
        total_loans_processed: totalLoans,
        test_duration_seconds: testDuration,
        average_throughput_lps: avgThroughput,  // Loans per second
        batches_processed: data.metrics.http_reqs?.values.count || 0,
        batch_error_rate: data.metrics.batch_errors?.values.rate || 0,
        batch_success_rate: data.metrics.batch_success?.values.rate || 0,
        avg_batch_size: data.metrics.batch_size?.values.avg || 0,
        latency_p95: data.metrics.batch_latency?.values['p(95)'] || 0,
        latency_p99: data.metrics.batch_latency?.values['p(99)'] || 0,
        latency_avg: data.metrics.batch_latency?.values.avg || 0,
        latency_max: data.metrics.batch_latency?.values.max || 0,
        peak_throughput_lps: data.metrics.settlement_throughput?.values.max || 0,
      },
      thresholds_passed: Object.entries(data.thresholds || {}).every(([_, v]) => v.ok),
      target_achieved: totalLoans >= 50000,  // Target threshold
    }, null, 2),
    'stdout': JSON.stringify(data, null, 2),
  };
}
