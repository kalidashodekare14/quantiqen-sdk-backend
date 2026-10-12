import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateDelay,
  isRetryable,
  parseRetryAfter,
  withRetry,
  sleep,
} from '../src/retry.js';

describe('retry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('calculateDelay', () => {
    const config = { maxRetries: 3, baseDelayMs: 1000 };

    it('returns retryAfterMs when provided and positive', () => {
      const delay = calculateDelay(0, config, 5000);
      expect(delay).toBe(5000);
    });

    it('ignores retryAfterMs when zero or negative', () => {
      const delay = calculateDelay(0, config, 0);
      expect(delay).toBeGreaterThanOrEqual(750);
      expect(delay).toBeLessThanOrEqual(1250);
    });

    it('exponential delay increases with attempt', () => {
      const delays: number[] = [];
      for (let i = 0; i < 4; i++) {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        delays.push(calculateDelay(i, config));
        vi.restoreAllMocks();
      }
      expect(delays[0]).toBeLessThan(delays[1]);
      expect(delays[1]).toBeLessThan(delays[2]);
      expect(delays[2]).toBeLessThan(delays[3]);
    });

    it('jitter produces different delays within tolerance', () => {
      const delays: number[] = [];
      for (let i = 0; i < 20; i++) {
        delays.push(calculateDelay(1, config));
      }
      const min = Math.min(...delays);
      const max = Math.max(...delays);
      expect(min).toBeGreaterThanOrEqual(1500);
      expect(max).toBeLessThanOrEqual(2500);
    });
  });

  describe('isRetryable', () => {
    it('retries on 429', () => {
      expect(isRetryable(429)).toBe(true);
    });

    it('retries on 500', () => {
      expect(isRetryable(500)).toBe(true);
    });

    it('retries on 503', () => {
      expect(isRetryable(503)).toBe(true);
    });

    it('does not retry on 400', () => {
      expect(isRetryable(400)).toBe(false);
    });

    it('does not retry on 401', () => {
      expect(isRetryable(401)).toBe(false);
    });

    it('does not retry on 403', () => {
      expect(isRetryable(403)).toBe(false);
    });

    it('does not retry on 404', () => {
      expect(isRetryable(404)).toBe(false);
    });

    it('does not retry on 422', () => {
      expect(isRetryable(422)).toBe(false);
    });
  });

  describe('parseRetryAfter', () => {
    it('parses numeric header', () => {
      expect(parseRetryAfter('30')).toBe(30000);
    });

    it('returns undefined for null header', () => {
      expect(parseRetryAfter(null)).toBeUndefined();
    });

    it('returns undefined for non-numeric header', () => {
      expect(parseRetryAfter('bad')).toBeUndefined();
    });

    it('clamps negative values to zero', () => {
      expect(parseRetryAfter('-5')).toBe(0);
    });
  });

  describe('withRetry', () => {
    it('returns result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const result = await withRetry(fn, { maxRetries: 2, baseDelayMs: 10 });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on failure and succeeds', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('ok');
      const result = await withRetry(fn, { maxRetries: 2, baseDelayMs: 10 });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws after max retries exhausted', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fails'));
      await expect(
        withRetry(fn, { maxRetries: 2, baseDelayMs: 10 }),
      ).rejects.toThrow('always fails');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('sleep', () => {
    it('resolves after delay', async () => {
      const start = Date.now();
      await sleep(50);
      expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    });
  });
});
