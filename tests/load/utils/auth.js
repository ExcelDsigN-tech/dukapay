/**
 * Authentication utilities for load tests
 */

const TEST_USERS = [
  'GCJPBXSE6WCQDCEYZW6C3YVZCSSCHC4AE72L5KWKCYL2CLLL7NH5VSCI',
  'GDLENDERXAMPLEKEY123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'GDAGENTXAMPLEKEY123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ1',
  'GDBORROWER2XAMPLEKEY123456789ABCDEFGHIJKLMNOPQRSTUVW',
  'GDBORROWER3XAMPLEKEY123456789ABCDEFGHIJKLMNOPQRSTUVW',
];

/**
 * Generate a test authentication token
 * In production, this should make an actual auth request
 */
export function generateAuthToken() {
  // For load testing, we use a long-lived test token
  // Set TEST_AUTH_TOKEN environment variable for real tokens
  return __ENV.TEST_AUTH_TOKEN || 'load-test-token-' + Date.now();
}

/**
 * Select a random test user for requests
 */
export function selectRandomUser() {
  return TEST_USERS[Math.floor(Math.random() * TEST_USERS.length)];
}

/**
 * Generate test user data
 */
export function generateTestUser() {
  const id = Math.floor(Math.random() * 10000);
  return {
    publicKey: selectRandomUser(),
    email: `loadtest${id}@dukapay.test`,
    kycVerified: true,
  };
}

/**
 * Generate API key for admin endpoints
 */
export function generateApiKey() {
  return __ENV.TEST_API_KEY || 'test-api-key';
}
