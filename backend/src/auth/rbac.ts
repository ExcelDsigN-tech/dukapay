export const USER_ROLES = ['admin', 'super_admin', 'ops', 'support', 'borrower', 'lender'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_SCOPES: Record<UserRole, string[]> = {
  admin: ['admin:all'],
  super_admin: ['admin:all', 'users:read', 'users:write', 'roles:write', 'feature_flags:write', 'kyc:override'],
  ops: ['admin:all', 'settlement:trigger', 'system:health', 'kyc:override'],
  support: ['admin:all', 'users:read', 'kyc:override'],
  borrower: [
    'read:loans',
    'write:loans',
    'read:score',
    'read:notifications',
    'write:notifications',
    'read:remittances',
    'write:remittances',
  ],
  lender: ['read:loans', 'read:pool', 'write:loans'],
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
  const superAdminWallets = parseWalletSet(process.env.SUPER_ADMIN_WALLETS);
  if (superAdminWallets.has(publicKey)) {
    return 'super_admin';
  }

  const opsWallets = parseWalletSet(process.env.OPS_WALLETS);
  if (opsWallets.has(publicKey)) {
    return 'ops';
  }

  const supportWallets = parseWalletSet(process.env.SUPPORT_WALLETS);
  if (supportWallets.has(publicKey)) {
    return 'support';
  }

  const adminWallets = parseWalletSet(process.env.ADMIN_WALLETS);
  if (adminWallets.has(publicKey)) {
    return 'admin';
  }

  const lenderWallets = parseWalletSet(process.env.LENDER_WALLETS);
  if (lenderWallets.has(publicKey)) {
    return 'lender';
  }

  return 'borrower';
};

export const resolveScopesForRole = (role: UserRole): string[] => {
  const ownScopes = ROLE_SCOPES[role] ?? [];
  if (role === 'admin' || role === 'super_admin' || role === 'ops' || role === 'support') {
    return [...ownScopes];
  }

  // Include admin scope only for full admin; keep role scopes explicit for others.
  return [...ownScopes];
};
