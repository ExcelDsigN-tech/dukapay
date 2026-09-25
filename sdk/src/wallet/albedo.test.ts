import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AlbedoAdapter,
  ALBEDO_SCRIPT_INTEGRITY,
  ALBEDO_SCRIPT_TIMEOUT_MS,
  ALBEDO_SCRIPT_URL,
} from './albedo.js';
import { WalletError } from '../errors.js';

interface FakeScript {
  src: string;
  integrity: string;
  crossOrigin: string | null;
  referrerPolicy: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  remove: () => void;
}

const g = globalThis as unknown as { document?: unknown; albedo?: unknown };

let appended: FakeScript[];

function lastScript(): FakeScript {
  const s = appended[appended.length - 1];
  if (!s) throw new Error('no script was appended');
  return s;
}

beforeEach(() => {
  appended = [];
  g.document = {
    createElement: () => {
      const s: FakeScript = {
        src: '',
        integrity: '',
        crossOrigin: null,
        referrerPolicy: '',
        onload: null,
        onerror: null,
        remove: () => {
          appended = appended.filter((x) => x !== s);
        },
      };
      return s;
    },
    head: { appendChild: (s: FakeScript) => appended.push(s) },
  };
});

afterEach(() => {
  delete g.document;
  delete g.albedo;
  vi.useRealTimers();
});

describe('AlbedoAdapter script loading', () => {
  it('pins the script to a versioned URL with an SRI hash and anonymous CORS', async () => {
    const connecting = new AlbedoAdapter().connect();
    const s = lastScript();

    expect(s.src).toBe(ALBEDO_SCRIPT_URL);
    expect(s.src).toMatch(/@\d+\.\d+\.\d+\//);
    expect(s.integrity).toBe(ALBEDO_SCRIPT_INTEGRITY);
    expect(s.integrity).toMatch(/^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/);
    expect(s.crossOrigin).toBe('anonymous');

    g.albedo = { publicKey: async () => ({ pubkey: 'GABC' }) };
    s.onload?.();
    await expect(connecting).resolves.toBe('GABC');
  });

  it('rejects with a readable error when the script fails to load (e.g. SRI mismatch)', async () => {
    const connecting = new AlbedoAdapter().connect();
    lastScript().onerror?.();

    await expect(connecting).rejects.toBeInstanceOf(WalletError);
    await expect(connecting).rejects.toThrow(/Could not load the Albedo wallet/);
    expect(appended).toHaveLength(0);
  });

  it('times out when the script never loads', async () => {
    vi.useFakeTimers();
    const connecting = new AlbedoAdapter().connect();
    const assertion = expect(connecting).rejects.toThrow(/Could not load the Albedo wallet/);

    vi.advanceTimersByTime(ALBEDO_SCRIPT_TIMEOUT_MS);

    await assertion;
    expect(appended).toHaveLength(0);
  });

  it('fails when the script loads but does not expose albedo', async () => {
    const connecting = new AlbedoAdapter().connect();
    lastScript().onload?.();

    await expect(connecting).rejects.toBeInstanceOf(WalletError);
  });
});
