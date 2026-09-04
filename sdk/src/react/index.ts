'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DukaPayClient, type DukaPayClientOptions } from '../client.js';
import type { Loan, PoolStats, Session } from '../types.js';
import type { WalletAdapter } from '../wallet/index.js';

// ── Provider ──────────────────────────────────────────────────────────────────

interface DukaPayContextValue {
  client: DukaPayClient;
  session: Session | null;
}

const DukaPayContext = createContext<DukaPayContextValue | null>(null);

export interface DukaPayProviderProps extends DukaPayClientOptions {
  children: ReactNode;
  /** Reuse an existing client instead of constructing one from props. */
  client?: DukaPayClient;
}

export function DukaPayProvider({ children, client: provided, ...opts }: DukaPayProviderProps) {
  const [session, setSession] = useState<Session | null>(null);
  const client = useMemo(
    () => provided ?? new DukaPayClient({ ...opts, onSession: setSession }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [provided],
  );
  useEffect(() => setSession(client.getSession()), [client]);

  return createElement(DukaPayContext.Provider, { value: { client, session } }, children);
}

export function useDukaPay(): DukaPayContextValue {
  const ctx = useContext(DukaPayContext);
  if (!ctx) throw new Error('useDukaPay must be used inside <DukaPayProvider>');
  return ctx;
}

// ── Generic async helper ──────────────────────────────────────────────────────

interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  isLoading: boolean;
  refetch: () => void;
}

function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [isLoading, setLoading] = useState(enabled);
  const [nonce, setNonce] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fnRef
      .current()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e as Error))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  return { data, error, isLoading, refetch: useCallback(() => setNonce((n) => n + 1), []) };
}

// ── useWallet ─────────────────────────────────────────────────────────────────

export interface UseWalletResult {
  address: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  isAuthenticated: boolean;
  error: Error | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** connect (if needed) + full challenge/sign/login flow. */
  login: () => Promise<void>;
}

export function useWallet(wallet?: WalletAdapter): UseWalletResult {
  const { client, session } = useDukaPay();
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setConnecting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (wallet) client.setWallet(wallet);
  }, [client, wallet]);

  useEffect(() => {
    (wallet ?? undefined)?.getAddress().then(setAddress).catch(() => {});
  }, [wallet]);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setConnecting(true);
      setError(null);
      try {
        await action();
        setAddress(await client.address());
      } catch (e) {
        setError(e as Error);
        throw e;
      } finally {
        setConnecting(false);
      }
    },
    [client],
  );

  return {
    address: address ?? session?.address ?? null,
    isConnected: Boolean(address),
    isConnecting,
    isAuthenticated: Boolean(session?.token),
    error,
    connect: useCallback(() => run(() => client.connectWallet()), [run, client]),
    disconnect: useCallback(
      () => run(async () => { await client.logout(); setAddress(null); }),
      [run, client],
    ),
    login: useCallback(() => run(() => client.loginWithWallet()), [run, client]),
  };
}

// ── useLoans ──────────────────────────────────────────────────────────────────

export interface UseLoansResult extends AsyncState<Loan[]> {
  repay: (loanId: number, amount: string) => Promise<Loan>;
}

export function useLoans(
  params: { borrower?: string; status?: string } = {},
): UseLoansResult {
  const { client, session } = useDukaPay();
  const borrower = params.borrower ?? session?.address;
  const state = useAsync<Loan[]>(
    () => client.loans.list({ ...params, borrower }).then((p) => p.items),
    [borrower, params.status],
    Boolean(borrower),
  );

  const repay = useCallback(
    async (loanId: number, amount: string) => {
      const unsigned = await client.loans.buildRepay(loanId, amount);
      const loan = await client.signAndSubmit(unsigned, (xdr) => client.loans.submit(loanId, xdr));
      state.refetch();
      return loan;
    },
    [client, state],
  );

  return { ...state, repay };
}

// ── useFloat ──────────────────────────────────────────────────────────────────

/**
 * Liquidity-pool ("float") position + actions for the connected depositor.
 */
export interface UseFloatResult {
  stats: PoolStats | undefined;
  portfolio: Awaited<ReturnType<DukaPayClient['pool']['depositor']>> | undefined;
  isLoading: boolean;
  error: Error | undefined;
  refetch: () => void;
  deposit: (amount: string) => Promise<void>;
  withdraw: (shares: string) => Promise<void>;
}

export function useFloat(token: string): UseFloatResult {
  const { client, session } = useDukaPay();
  const address = session?.address;

  const stats = useAsync<PoolStats>(() => client.pool.stats(token), [token]);
  const portfolio = useAsync(
    () => client.pool.depositor(address as string),
    [token, address],
    Boolean(address),
  );

  const act = useCallback(
    async (build: () => Promise<{ xdr: string }>) => {
      const unsigned = await build();
      await client.signAndSubmit(unsigned, async (xdr) => {
        await client.http.post('/pool/submit', { signedXdr: xdr });
      });
      stats.refetch();
      portfolio.refetch();
    },
    [client, stats, portfolio],
  );

  return {
    stats: stats.data,
    portfolio: portfolio.data,
    isLoading: stats.isLoading || portfolio.isLoading,
    error: stats.error ?? portfolio.error,
    refetch: () => {
      stats.refetch();
      portfolio.refetch();
    },
    deposit: (amount: string) =>
      act(() => client.pool.buildDeposit({ token, amount, from: address as string })),
    withdraw: (shares: string) =>
      act(() => client.pool.buildWithdraw({ token, shares, from: address as string })),
  };
}
