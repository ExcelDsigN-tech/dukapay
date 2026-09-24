import { DukaPayError } from './errors.js';

export interface HttpClientOptions {
  /** API base URL, e.g. https://api.dukapay.io */
  baseUrl: string;
  /** Static bearer token, or a function returning one (sync or async). */
  token?: string | (() => string | null | undefined | Promise<string | null | undefined>);
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Total attempts for retryable failures (default 3). */
  maxRetries?: number;
  /** Base backoff in ms, doubled each retry (default 300). */
  retryBackoffMs?: number;
  /** Per-request timeout in ms (default 30000). */
  timeoutMs?: number;
  /** Injectable fetch, for tests / non-browser runtimes. */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  /** Skip the Authorization header for public endpoints. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

const RETRYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class HttpClient {
  private readonly baseUrl: string;
  private readonly baseHeaders: Record<string, string>;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private token: HttpClientOptions['token'];

  constructor(options: HttpClientOptions) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new DukaPayError('No fetch implementation available; pass `fetch` in options.');
    }
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.baseHeaders = options.headers ?? {};
    this.maxRetries = options.maxRetries ?? 3;
    this.retryBackoffMs = options.retryBackoffMs ?? 300;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.token = options.token;
  }

  setToken(token: HttpClientOptions['token']): void {
    this.token = token;
  }

  private async resolveToken(): Promise<string | undefined> {
    const t = this.token;
    const v = typeof t === 'function' ? await t() : t;
    return v ?? undefined;
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(this.baseUrl + (path.startsWith('/') ? path : `/${path}`));
    for (const [k, v] of Object.entries(options.query ?? {})) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      ...this.baseHeaders,
      ...options.headers,
    };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (!options.anonymous) {
      const token = await this.resolveToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }

    const canRetry = RETRYABLE_METHODS.has(method.toUpperCase());
    const attempts = canRetry ? this.maxRetries : 1;
    let lastErr: DukaPayError | undefined;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      const onExternalAbort = () => ac.abort();
      options.signal?.addEventListener('abort', onExternalAbort, { once: true });

      try {
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: ac.signal,
        });
        const parsed = await parseBody(res);
        if (res.ok) return parsed as T;

        const err = toError(res, parsed);
        if (!err.isRetryable || attempt === attempts - 1) throw err;
        lastErr = err;
      } catch (e) {
        const err =
          e instanceof DukaPayError
            ? e
            : new DukaPayError((e as Error)?.message ?? 'network error', { status: 0 });
        if (!err.isRetryable || attempt === attempts - 1) throw err;
        lastErr = err;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onExternalAbort);
      }

      await sleep(this.retryBackoffMs * 2 ** attempt);
    }
    throw lastErr ?? new DukaPayError('request failed');
  }

  get<T>(path: string, options?: RequestOptions) {
    return this.request<T>('GET', path, options);
  }
  post<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('POST', path, { ...options, body });
  }
  put<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('PUT', path, { ...options, body });
  }
  patch<T>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('PATCH', path, { ...options, body });
  }
  delete<T>(path: string, options?: RequestOptions) {
    return this.request<T>('DELETE', path, options);
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toError(res: Response, body: unknown): DukaPayError {
  const envelope = (body ?? {}) as Record<string, unknown>;
  const message =
    (typeof envelope.message === 'string' && envelope.message) ||
    (typeof envelope.error === 'string' && envelope.error) ||
    `HTTP ${res.status} ${res.statusText}`;
  return new DukaPayError(message, {
    status: res.status,
    code: typeof envelope.code === 'string' ? envelope.code : undefined,
    body,
    requestId: res.headers.get('x-request-id') ?? undefined,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
