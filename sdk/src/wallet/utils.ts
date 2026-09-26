import { WalletError } from '../errors.js';

export class TimeoutError extends WalletError {
  constructor() {
    super('Wallet operation timed out after 10 seconds');
    this.name = 'TimeoutError';
  }
}

interface RetryOptions {
  timeout: number;
  retryable: boolean;
}

export async function withTimeoutAndRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions
): Promise<T> {
  const maxRetries = opts.retryable ? 3 : 1;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new TimeoutError()), opts.timeout)
        ),
      ]);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries) {
        throw lastError;
      }

      if (opts.retryable && isRetryableError(error)) {
        const delay = Math.pow(2, attempt - 1) * 100;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError || new Error('Unknown error');
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  if (error instanceof TimeoutError) return true;
  if (error instanceof TypeError && error.message.includes('fetch')) return true;
  if (error.message.includes('network')) return true;
  if (error.message.includes('timeout')) return true;

  return false;
}
