/** Normalised error thrown by every SDK call. */
export class DukaPayError extends Error {
  /** HTTP status, or 0 for network/transport failures. */
  readonly status: number;
  /** Machine-readable code from the API envelope when present. */
  readonly code?: string;
  /** Raw parsed response body, if any. */
  readonly body?: unknown;
  /** Request id echoed by the API, useful for support tickets. */
  readonly requestId?: string;

  constructor(
    message: string,
    opts: { status?: number; code?: string; body?: unknown; requestId?: string } = {},
  ) {
    super(message);
    this.name = 'DukaPayError';
    this.status = opts.status ?? 0;
    this.code = opts.code;
    this.body = opts.body;
    this.requestId = opts.requestId;
  }

  get isRetryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export class WalletError extends DukaPayError {
  constructor(message: string, body?: unknown) {
    super(message, { body });
    this.name = 'WalletError';
  }
}
