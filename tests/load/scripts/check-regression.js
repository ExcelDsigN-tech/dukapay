#!/usr/bin/env node
/**
 * Check for performance regressions by comparing current results to baselines
 * Alerts when latency increases by more than 20%
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESULTS_DIR = path.join(__dirname, '..', 'results');
const BASELINES_DIR = path.join(__dirname, '..', 'baselines');
const REGRESSION_THRESHOLD = 0.20;  // 20% threshold

const SCENARIOS = [
  'api-read',
  'api-write',
  'contract-calls',
  'settlement-batch',
];

/**
 * Compare two metric values and check for regression
 */
function checkRegression(baseline, current, metricName, higherIsBetter = false) {
  if (baseline === undefined || current === undefined) {
    return null;
  }
  
  const difference = current - baseline;
  const percentChange = baseline !== 0 ? (difference / baseline) : 0;
  
  let isRegression = false;
  if (higherIsBetter) {
    // For metrics like throughput, lower is bad
    isRegression = percentChange < -REGRESSION_THRESHOLD;
  } else {
    // For metrics like latency/error rate, higher is bad
    isRegression = percentChange > REGRESSION_THRESHOLD;
  }
  
  return {
    metric: metricName,
    baseline,
    current,
    difference,
    percentChange: percentChange * 100,
    isRegression,
    threshold: REGRESSION_THRESHOLD * 100,
  };
}

/**
 * Analyze a single scenario for regressions
 */
function analyzeScenario(scenario) {
  const baselineFile = path.join(BASELINES_DIR, `${scenario}-baseline.json`);
  const resultsFile = path.join(RESULTS_DIR, `${scenario}-summary.json`);
  
  if (!fs.existsSync(baselineFile)) {
    return {
      scenario,
      error: 'No baseline found',
      hasRegression: false,
    };
  }
  
  if (!fs.existsSync(resultsFile)) {
    return {
      scenario,
      error: 'No current results found',
      hasRegression: false,
    };
  }
  
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const current = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  
  const baselineMetrics = baseline.metrics || {};
  const currentMetrics = current.metrics || {};
  
  // Metrics to check
  const checks = [
    checkRegression(
      baselineMetrics.latency_p95,
      currentMetrics.latency_p95,
      'Latency (p95)',
      false
    ),
    checkRegression(
      baselineMetrics.latency_p99,
      currentMetrics.latency_p99,
      'Latency (p99)',
      false
    ),
    checkRegression(
      baselineMetrics.error_rate,
      currentMetrics.error_rate,
      'Error Rate',
      false
    ),
    checkRegression(
      baselineMetrics.requests_per_second,
      currentMetrics.requests_per_second,
      'Throughput (RPS)',
      true
    ),
  ].filter(check => check !== null);
  
  const regressions = checks.filter(check => check.isRegression);
  
  return {
    scenario,
    checks,
    regressions,
    hasRegression: regressions.length > 0,
  };
}

/**
 * Generate regression report
 */
function generateReport(analyses) {
  console.log('\n🔍 Performance Regression Analysis');
  console.log('═'.repeat(80));
  console.log(`Threshold: ${REGRESSION_THRESHOLD * 100}% change`);
  console.log('═'.repeat(80));
  
  let totalRegressions = 0;
  const failedScenarios = [];
  
  for (const analysis of analyses) {
    console.log(`\n${analysis.scenario.toUpperCase()}`);
    console.log('─'.repeat(80));
    
    if (analysis.error) {
      console.log(`  ⚠️  ${analysis.error}`);
      continue;
    }
    
    if (analysis.checks.length === 0) {
      console.log('  ℹ️  No comparable metrics found');
      continue;
    }
    
    for (const check of analysis.checks) {
      const icon = check.isRegression ? '❌' : '✅';
      const arrow = check.percentChange > 0 ? '↑' : '↓';
      
      console.log(
        `  ${icon} ${check.metric.padEnd(20)} ` +
        `${arrow} ${Math.abs(check.percentChange).toFixed(2)}%`
      );
      
      if (check.isRegression) {
        console.log(
          `     Baseline: ${check.baseline.toFixed(2)} → ` +
          `Current: ${check.current.toFixed(2)}`
        );
      }
    }
    
    if (analysis.hasRegression) {
      totalRegressions += analysis.regressions.length;
      failedScenarios.push(analysis.scenario);
      console.log(`\n  ⚠️  ${analysis.regressions.length} regression(s) detected!`);
    } else {
      console.log('\n  ✅ No regressions detected');
    }
  }
  
  console.log('\n' + '═'.repeat(80));
  
  if (totalRegressions > 0) {
    console.log(`\n❌ REGRESSION ALERT: ${totalRegressions} regression(s) found!`);
    console.log(`\nFailed scenarios: ${failedScenarios.join(', ')}`);
    console.log('\n🚨 Action required: Investigate performance degradation');
    return false;
  } else {
    console.log('\n✅ All performance metrics within acceptable range');
    return true;
  }
}

/**
 * Save regression report to file
 */
function saveReport(analyses) {
  const reportFile = path.join(RESULTS_DIR, 'regression-report.json');
  const report = {
    timestamp: new Date().toISOString(),
    threshold: REGRESSION_THRESHOLD,
    scenarios: analyses,
    summary: {
      total_scenarios: analyses.length,
      scenarios_with_regressions: analyses.filter(a => a.hasRegression).length,
      total_regressions: analyses.reduce((sum, a) => sum + (a.regressions?.length || 0), 0),
    },
  };
  
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved: ${reportFile}`);
}

/**
 * Send alert (placeholder for actual alerting system)
 */
function sendAlert(analyses) {
  const regressionCount = analyses.reduce(
    (sum, a) => sum + (a.regressions?.length || 0),
    0
  );
  
  if (regressionCount > 0) {
    console.log('\n🚨 Sending regression alert...');
    
    // In production, this would integrate with:
    // - Slack/Discord webhooks
    // - PagerDuty
    // - Email notifications
    // - GitHub Issues
    
    const alertMessage = {
      type: 'performance_regression',
      severity: 'high',
      count: regressionCount,
      scenarios: analyses.filter(a => a.hasRegression).map(a => a.scenario),
      timestamp: new Date().toISOString(),
      environment: process.env.TEST_ENV || 'staging',
    };
    
    console.log('Alert payload:', JSON.stringify(alertMessage, null, 2));
    
    // TODO: Implement actual alerting
    // await sendToSlack(alertMessage);
    // await createGitHubIssue(alertMessage);
  }
}

/**
 * Main execution
 */
function main() {
  console.log('🎯 DukaPay Performance Regression Checker');
  
  const analyses = SCENARIOS.map(analyzeScenario);
  const passed = generateReport(analyses);
  
  saveReport(analyses);
  sendAlert(analyses);
  
  console.log('\n' + '═'.repeat(80) + '\n');
  
  process.exit(passed ? 0 : 1);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { analyzeScenario, generateReport, checkRegression };
