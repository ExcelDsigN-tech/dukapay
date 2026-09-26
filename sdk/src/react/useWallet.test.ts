/**
 * Tests for the useWallet hook — verifies the cancelled-flag pattern added
 * in fix #534 (no state update after component unmounts while getAddress()
 * is pending).
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { DukaPayProvider } from './index.js';
import { useWallet } from './index.js';
import type { WalletAdapter } from '../wallet/index.js';
import { DukaPayClient } from '../client.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeWallet(getAddress: () => Promise<string>): WalletAdapter {
  return {
    getAddress,
    signTransaction: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as WalletAdapter;
}

function makeClient() {
  return new DukaPayClient({ baseUrl: 'http://localhost:3001' });
}

function wrapper(client: DukaPayClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(DukaPayProvider, { client }, children);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useWallet — unmount safety (#534)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not update address state after the component unmounts', async () => {
    // Arrange: a promise we control — getAddress resolves only after unmount.
    let resolveAddress!: (addr: string) => void;
    const pendingAddress = new Promise<string>((res) => { resolveAddress = res; });

    const wallet = makeWallet(() => pendingAddress);
    const client = makeClient();

    const { result, unmount } = renderHook(() => useWallet(wallet), {
      wrapper: wrapper(client),
    });

    // address starts null
    expect(result.current.address).toBeNull();

    // Unmount before the promise resolves — this is the scenario that triggered
    // the React warning before fix #534.
    unmount();

    // Act: resolve the promise after unmount
    const warnSpy = vi.spyOn(console, 'error');
    act(() => { resolveAddress('GABCD1234'); });

    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 0));

    // Assert: no React "Can't perform a state update on an unmounted component"
    // warning should have fired.
    const reactWarnings = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('unmounted component'),
    );
    expect(reactWarnings).toHaveLength(0);
  });

  it('sets address when the component is still mounted when getAddress resolves', async () => {
    let resolveAddress!: (addr: string) => void;
    const pendingAddress = new Promise<string>((res) => { resolveAddress = res; });

    const wallet = makeWallet(() => pendingAddress);
    const client = makeClient();

    const { result } = renderHook(() => useWallet(wallet), {
      wrapper: wrapper(client),
    });

    expect(result.current.address).toBeNull();

    act(() => { resolveAddress('GABCD5678'); });

    await waitFor(() => expect(result.current.address).toBe('GABCD5678'));
  });
});
