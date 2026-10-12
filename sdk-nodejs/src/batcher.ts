// SPDX-License-Identifier: MIT
import type { EventData } from './types.js';

export interface BatcherConfig {
  batchSize: number;
  flushIntervalMs: number;
  onFlush: (events: EventData[]) => Promise<void>;
  logger: (msg: string) => void;
}

export interface RateLimitState {
  remaining: number | null;
  retryAfterMs: number | null;
  pausedUntil: number;
}

export class EventBatcher {
  private queue: EventData[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private rateLimit: RateLimitState = {
    remaining: null,
    retryAfterMs: null,
    pausedUntil: 0,
  };

  constructor(private readonly config: BatcherConfig) {}

  add(event: EventData): void {
    this.queue.push(event);
    if (this.queue.length >= this.config.batchSize) {
      void this.flush();
    }
  }

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.config.flushIntervalMs);
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;

    if (Date.now() < this.rateLimit.pausedUntil) {
      const waitMs = this.rateLimit.pausedUntil - Date.now();
      if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    }

    // The Retry-After pause has elapsed (or was never set) — drop the stale
    // delay so it is not re-applied to every later flush.
    if (Date.now() >= this.rateLimit.pausedUntil) {
      this.rateLimit.retryAfterMs = null;
    }

    if (this.queue.length === 0) return;

    this.flushing = true;
    try {
      const delay = this.calculateThrottleDelay();
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }

      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.config.batchSize);
        try {
          await this.config.onFlush(batch);
        } catch (err) {
          this.config.logger(
            `[quantiqen-sdk] Flush failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  async shutdown(): Promise<void> {
    this.stop();
    await this.flush();
  }

  updateRateLimit(headers: Record<string, string>): void {
    const remaining = headers['x-ratelimit-remaining'];
    if (remaining !== undefined) {
      this.rateLimit.remaining = Number(remaining);
    }

    const retryAfter = headers['retry-after'];
    if (retryAfter !== undefined) {
      const ms = Number(retryAfter) * 1000;
      if (!Number.isNaN(ms) && ms > 0) {
        this.rateLimit.retryAfterMs = ms;
        this.rateLimit.pausedUntil = Date.now() + ms;
      }
    }
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  private calculateThrottleDelay(): number {
    if (this.rateLimit.retryAfterMs !== null) {
      return this.rateLimit.retryAfterMs;
    }

    const remaining = this.rateLimit.remaining;
    if (remaining !== null && remaining < 5) {
      return (5 - remaining) * 500;
    }

    return 0;
  }
}
