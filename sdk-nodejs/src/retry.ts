// SPDX-License-Identifier: MIT
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
};

export function calculateDelay(
  attempt: number,
  config: RetryConfig,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return retryAfterMs;
  }
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  const jitter = exponential * (0.75 + Math.random() * 0.5);
  return Math.floor(jitter);
}

export function isRetryable(statusCode: number): boolean {
  if (statusCode === 429) return true;
  if (statusCode >= 500) return true;
  return false;
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, seconds) * 1000;
  }
  return undefined;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === config.maxRetries) break;
      const delay = calculateDelay(attempt, config);
      await sleep(delay);
    }
  }
  throw lastError;
}
