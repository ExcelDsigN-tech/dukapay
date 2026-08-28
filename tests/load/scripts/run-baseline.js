#!/usr/bin/env node
/**
 * Run baseline load tests and store results
 * This script runs all load test scenarios and saves results as baselines
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCENARIOS = [
  'api-read',
  'api-write',
  'contract-calls',
  'settlement-batch',
];

const RESULTS_DIR = path.join(__dirname, '..', 'results');
const BASELINES_DIR = path.join(__dirname, '..', 'baselines');

// Ensure directories exist
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

if (!fs.existsSync(BASELINES_DIR)) {
  fs.mkdirSync(BASELINES_DIR, { recursive: true });
}

/**
 * Run a single k6 test scenario
 */
function runScenario(scenario) {
  return new Promise((resolve, reject) => {
    console.log(`\n🚀 Running ${scenario} baseline test...`);
    
    const scriptPath = path.join(__dirname, '..', 'scenarios', `${scenario}.js`);
    const k6Process = spawn('k6', ['run', scriptPath], {
      env: {
        ...process.env,
        TEST_ENV: process.env.TEST_ENV || 'staging',
      },
      stdio: 'inherit',
    });

    k6Process.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ ${scenario} baseline test completed`);
        resolve();
      } else {
        console.error(`❌ ${scenario} baseline test failed with code ${code}`);
        reject(new Error(`Test failed with code ${code}`));
      }
    });

    k6Process.on('error', (err) => {
      console.error(`❌ Failed to start ${scenario}: ${err.message}`);
      reject(err);
    });
  });
}

/**
 * Copy results to baselines directory
 */
function saveBaseline(scenario) {
  const resultsFile = path.join(RESULTS_DIR, `${scenario}-summary.json`);
  const baselineFile = path.join(BASELINES_DIR, `${scenario}-baseline.json`);
  
  if (fs.existsSync(resultsFile)) {
    const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    
    // Add baseline metadata
    const baseline = {
      ...results,
      baseline_created_at: new Date().toISOString(),
      baseline_version: process.env.GIT_SHA || 'unknown',
      baseline_environment: process.env.TEST_ENV || 'staging',
    };
    
    fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2));
    console.log(`📊 Baseline saved: ${baselineFile}`);
  } else {
    console.warn(`⚠️  Results file not found: ${resultsFile}`);
  }
}

/**
 * Generate summary report
 */
function generateSummary() {
  console.log('\n📈 Baseline Summary\n');
  console.log('═'.repeat(80));
  
  for (const scenario of SCENARIOS) {
    const baselineFile = path.join(BASELINES_DIR, `${scenario}-baseline.json`);
    
    if (fs.existsSync(baselineFile)) {
      const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
      const metrics = baseline.metrics || {};
      
      console.log(`\n${scenario.toUpperCase()}`);
      console.log('─'.repeat(80));
      console.log(`  Environment:        ${baseline.environment}`);
      console.log(`  Timestamp:          ${baseline.timestamp}`);
      
      if (metrics.requests_per_second) {
        console.log(`  RPS:                ${metrics.requests_per_second.toFixed(2)}`);
      }
      
      if (metrics.transactions_per_second) {
        console.log(`  TPS:                ${metrics.transactions_per_second.toFixed(2)}`);
      }
      
      if (metrics.latency_p95) {
        console.log(`  Latency (p95):      ${metrics.latency_p95.toFixed(2)}ms`);
      }
      
      if (metrics.latency_p99) {
        console.log(`  Latency (p99):      ${metrics.latency_p99.toFixed(2)}ms`);
      }
      
      if (metrics.error_rate !== undefined) {
        console.log(`  Error Rate:         ${(metrics.error_rate * 100).toFixed(2)}%`);
      }
      
      if (metrics.total_loans_processed) {
        console.log(`  Loans Processed:    ${metrics.total_loans_processed}`);
      }
    }
  }
  
  console.log('\n' + '═'.repeat(80));
  console.log('\n✅ All baselines established successfully!\n');
}

/**
 * Main execution
 */
async function main() {
  console.log('🎯 DukaPay Load Test Baseline Runner');
  console.log('═'.repeat(80));
  console.log(`Environment: ${process.env.TEST_ENV || 'staging'}`);
  console.log(`Scenarios: ${SCENARIOS.join(', ')}`);
  console.log('═'.repeat(80));
  
  try {
    // Run all scenarios sequentially
    for (const scenario of SCENARIOS) {
      await runScenario(scenario);
      saveBaseline(scenario);
      
      // Wait between scenarios to avoid resource contention
      if (SCENARIOS.indexOf(scenario) < SCENARIOS.length - 1) {
        console.log('\n⏳ Waiting 30 seconds before next scenario...');
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }
    
    // Generate summary
    generateSummary();
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Baseline run failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runScenario, saveBaseline, generateSummary };
