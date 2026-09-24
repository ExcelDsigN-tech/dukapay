/**
 * Load Test Configuration
 */

export function getConfig() {
  const env = __ENV.TEST_ENV || 'staging';
  
  const configs = {
    local: {
      baseUrl: 'http://localhost:4000',
      rpcUrl: 'http://localhost:8000',
    },
    staging: {
      baseUrl: __ENV.STAGING_API_URL || 'https://api.staging.dukapay.io',
      rpcUrl: __ENV.STAGING_RPC_URL || 'https://rpc.staging.dukapay.io',
    },
    production: {
      baseUrl: __ENV.PROD_API_URL || 'https://api.dukapay.io',
      rpcUrl: __ENV.PROD_RPC_URL || 'https://rpc.dukapay.io',
    },
  };

  return configs[env] || configs.staging;
}

export function getTestDuration() {
  return {
    short: '5m',
    medium: '15m',
    long: '30m',
  }[__ENV.TEST_DURATION || 'medium'];
}

export function getTargetRPS() {
  const profile = __ENV.LOAD_PROFILE || 'normal';
  
  return {
    smoke: { read: 10, write: 1, contract: 1 },
    normal: { read: 1000, write: 100, contract: 100 },
    stress: { read: 2000, write: 200, contract: 150 },
    spike: { read: 5000, write: 500, contract: 200 },
  }[profile];
}
