/**
 * Test data generators for load tests
 */

/**
 * Generate loan request data
 */
export function generateLoanRequest(user) {
  return {
    borrower: user.publicKey,
    principal: Math.floor(Math.random() * 9000) + 1000,  // 1000-10000
    asset: 'USDC',
    interestRateBps: 800,  // 8%
    termLedgers: Math.floor(Math.random() * 365) + 30,  // 30-395 days
    collateralType: 'nft',
    collateralId: `nft_${Math.random().toString(36).substr(2, 9)}`,
  };
}

/**
 * Generate repayment data
 */
export function generateRepayment() {
  return {
    amount: Math.floor(Math.random() * 5000) + 100,  // 100-5100
    asset: 'USDC',
  };
}

/**
 * Generate dispute data
 */
export function generateDispute() {
  const reasons = [
    'incorrect_terms',
    'payment_not_reflected',
    'unauthorized_charge',
    'service_not_delivered',
  ];
  
  return {
    reason: reasons[Math.floor(Math.random() * reasons.length)],
    description: `Load test dispute - ${Date.now()}`,
    evidence: [],
  };
}

/**
 * Generate remittance data
 */
export function generateRemittance() {
  const currencies = ['NGN', 'KES', 'GHS', 'UGX'];
  
  return {
    recipientAddress: 'GA' + 'A'.repeat(54),
    amount: Math.floor(Math.random() * 1000) + 50,
    fromCurrency: 'USDC',
    toCurrency: currencies[Math.floor(Math.random() * currencies.length)],
  };
}

/**
 * Generate contract call data
 */
export function generateContractCall() {
  return {
    operation: 'test_operation',
    params: {
      value: Math.floor(Math.random() * 10000),
      timestamp: Date.now(),
    },
  };
}

/**
 * Generate batch of loan IDs
 */
export function generateLoanBatch(size = 100) {
  const loans = [];
  for (let i = 0; i < size; i++) {
    loans.push(Math.floor(Math.random() * 10000) + 1);
  }
  return loans;
}

/**
 * Generate settlement batch data
 */
export function generateSettlementBatch(size = 1000) {
  const settlements = [];
  for (let i = 0; i < size; i++) {
    settlements.push({
      id: `settle_${Math.random().toString(36).substr(2, 9)}`,
      remittanceId: `rem_${Math.random().toString(36).substr(2, 9)}`,
      amount: Math.floor(Math.random() * 5000) + 100,
      currency: 'USDC',
    });
  }
  return settlements;
}
