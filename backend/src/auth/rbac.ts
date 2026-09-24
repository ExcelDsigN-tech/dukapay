export const USER_ROLES = ['admin', 'agent', 'borrower', 'auditor', 'lender'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_SCOPES: Record<UserRole, string[]> = {
  admin: ['admin:all'],
  agent: [
    'read:loans',
    'write:loans',
    'read:pool',
    'read:score',
    'read:notifications',
    'write:notifications',
    'read:remittances',
    'write:remittances',
    'agents:view-assigned',
  ],
  borrower: [
    'read:loans',
    'write:loans',
    'read:score',
    'read:notifications',
    'write:notifications',
    'read:remittances',
    'write:remittances',
  ],
  /**
   * Read-only elevation over audit, compliance and KYC surfaces. Auditors can
   * inspect everything but never mutate state (the middleware layer guarantees
   * this by refusing write-scopes for the auditor role). The read:* scopes here
   * mirror the route gates so auditors can reach loan, score, notification,
   * remittance and pool reads without any write scope.
   */
  auditor: [
    'read:audit',
    'read:compliance',
    'read:loans',
    'read:score',
    'read:notifications',
    'read:remittances',
    'read:pool',
  ],
  // `lender` is retained as a legacy alias for the pool-provider role that
  // predates the `agent` naming. New integrations should use `agent`.
  lender: ['read:loans', 'read:pool', 'write:loans'],
};

/** Privilege ordering used for read-level "at least" comparisons. */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  admin: 4,
  agent: 3,
  auditor: 2,
  lender: 3,
  borrower: 1,
};

const parseWalletSet = (wallets: string | undefined): Set<string> => {
  if (!wallets) return new Set();

  return new Set(
    wallets
      .split(',')
      .map((wallet) => wallet.trim())
      .filter((wallet) => wallet.length > 0),
  );
};

export const resolveRoleForWallet = (publicKey: string): UserRole => {
  const adminWallets = parseWalletSet(process.env.ADMIN_WALLETS);
  if (adminWallets.has(publicKey)) {
    return 'admin';
  }

  const agentWallets = parseWalletSet(process.env.AGENT_WALLETS);
  if (agentWallets.has(publicKey)) {
    return 'agent';
  }

  const auditorWallets = parseWalletSet(process.env.AUDITOR_WALLETS);
  if (auditorWallets.has(publicKey)) {
    return 'auditor';
  }

  const lenderWallets = parseWalletSet(process.env.LENDER_WALLETS);
  if (lenderWallets.has(publicKey)) {
    return 'lender';
  }

  return 'borrower';
};

export const resolveScopesForRole = (role: UserRole): string[] => {
  return [...(ROLE_SCOPES[role] ?? [])];
};

/** True when `role` sits at or above `minimum` in the privilege ordering. */
export const isRoleAtLeast = (role: UserRole | undefined, minimum: UserRole): boolean => {
  if (!role) return false;
  return (ROLE_HIERARCHY[role] ?? 0) >= (ROLE_HIERARCHY[minimum] ?? 0);
};
