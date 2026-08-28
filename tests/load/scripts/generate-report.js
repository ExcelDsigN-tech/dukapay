#!/usr/bin/env node
/**
 * Generate comprehensive HTML report from load test results
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESULTS_DIR = path.join(__dirname, '..', 'results');
const BASELINES_DIR = path.join(__dirname, '..', 'baselines');

const SCENARIOS = [
  { id: 'api-read', name: 'API Read Operations', target: '1000 RPS' },
  { id: 'api-write', name: 'API Write Operations', target: '100 RPS' },
  { id: 'contract-calls', name: 'Contract Calls', target: '100 TPS' },
  { id: 'settlement-batch', name: 'Settlement Batch', target: '1000 loans' },
];

function generateHTML(data) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DukaPay Load Test Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; margin-bottom: 10px; }
        .meta { color: #7f8c8d; margin-bottom: 30px; }
        .scenario { margin-bottom: 40px; border: 1px solid #e1e8ed; border-radius: 8px; padding: 20px; }
        .scenario h2 { color: #34495e; margin-bottom: 15px; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .metric { background: #f8f9fa; padding: 15px; border-radius: 6px; }
        .metric-label { font-size: 0.9em; color: #7f8c8d; margin-bottom: 5px; }
        .metric-value { font-size: 1.5em; font-weight: bold; color: #2c3e50; }
        .metric-unit { font-size: 0.8em; color: #95a5a6; }
        .status { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 0.9em; font-weight: 500; }
        .status.pass { background: #d4edda; color: #155724; }
        .status.fail { background: #f8d7da; color: #721c24; }
        .status.warn { background: #fff3cd; color: #856404; }
        .comparison { margin-top: 15px; padding-top: 15px; border-top: 1px solid #e1e8ed; }
        .comparison-item { display: flex; justify-content: space-between; padding: 8px 0; }
        .trend { font-weight: bold; }
        .trend.up { color: #e74c3c; }
        .trend.down { color: #27ae60; }
        .trend.neutral { color: #95a5a6; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e1e8ed; }
        th { background: #f8f9fa; font-weight: 600; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e1e8ed; text-align: center; color: #7f8c8d; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎯 DukaPay Load Test Report</h1>
        <div class="meta">
            <p>Generated: ${new Date().toISOString()}</p>
            <p>Environment: ${data.environment || 'staging'}</p>
        </div>
        
        ${data.scenarios.map(scenario => `
            <div class="scenario">
                <h2>${scenario.name}</h2>
                <p><strong>Target:</strong> ${scenario.target}</p>
                <p><strong>Status:</strong> <span class="status ${scenario.status}">${scenario.status}</span></p>
                
                <div class="metrics">
                    ${scenario.metrics.map(metric => `
                        <div class="metric">
                            <div class="metric-label">${metric.label}</div>
                            <div class="metric-value">
                                ${metric.value}
                                <span class="metric-unit">${metric.unit}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
                
                ${scenario.comparison ? `
                    <div class="comparison">
                        <h3>vs Baseline</h3>
                        ${scenario.comparison.map(comp => `
                            <div class="comparison-item">
                                <span>${comp.metric}</span>
                                <span class="trend ${comp.trend}">${comp.change}</span>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
            </div>
        `).join('')}
        
        <div class="footer">
            <p>DukaPay Load Testing Suite | Powered by k6</p>
        </div>
    </div>
</body>
</html>`;
}

function collectData() {
  const data = {
    environment: process.env.TEST_ENV || 'staging',
    scenarios: [],
  };
  
  for (const scenario of SCENARIOS) {
    const resultsFile = path.join(RESULTS_DIR, `${scenario.id}-summary.json`);
    const baselineFile = path.join(BASELINES_DIR, `${scenario.id}-baseline.json`);
    
    if (!fs.existsSync(resultsFile)) {
      continue;
    }
    
    const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    const metrics = results.metrics || {};
    
    const scenarioData = {
      name: scenario.name,
      target: scenario.target,
      status: results.thresholds_passed !== false ? 'pass' : 'fail',
      metrics: [
        { label: 'Total Requests', value: (metrics.requests_total || 0).toLocaleString(), unit: '' },
        { label: 'RPS / TPS', value: (metrics.requests_per_second || metrics.transactions_per_second || 0).toFixed(2), unit: '' },
        { label: 'P95 Latency', value: (metrics.latency_p95 || 0).toFixed(2), unit: 'ms' },
        { label: 'P99 Latency', value: (metrics.latency_p99 || 0).toFixed(2), unit: 'ms' },
        { label: 'Error Rate', value: ((metrics.error_rate || 0) * 100).toFixed(2), unit: '%' },
      ],
    };
    
    // Add comparison if baseline exists
    if (fs.existsSync(baselineFile)) {
      const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
      const baselineMetrics = baseline.metrics || {};
      
      scenarioData.comparison = [];
      
      if (baselineMetrics.latency_p95 && metrics.latency_p95) {
        const change = ((metrics.latency_p95 - baselineMetrics.latency_p95) / baselineMetrics.latency_p95) * 100;
        scenarioData.comparison.push({
          metric: 'P95 Latency',
          change: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
          trend: change > 5 ? 'up' : change < -5 ? 'down' : 'neutral',
        });
      }
      
      if (baselineMetrics.error_rate !== undefined && metrics.error_rate !== undefined) {
        const change = ((metrics.error_rate - baselineMetrics.error_rate) / (baselineMetrics.error_rate || 0.01)) * 100;
        scenarioData.comparison.push({
          metric: 'Error Rate',
          change: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
          trend: change > 10 ? 'up' : change < -10 ? 'down' : 'neutral',
        });
      }
    }
    
    data.scenarios.push(scenarioData);
  }
  
  return data;
}

function main() {
  console.log('📊 Generating load test report...');
  
  const data = collectData();
  const html = generateHTML(data);
  
  const reportPath = path.join(RESULTS_DIR, 'load-test-report.html');
  fs.writeFileSync(reportPath, html);
  
  console.log(`✅ Report generated: ${reportPath}`);
  console.log(`📈 Scenarios included: ${data.scenarios.length}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generateHTML, collectData };
