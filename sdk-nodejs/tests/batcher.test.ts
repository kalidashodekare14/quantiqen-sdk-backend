import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBatcher } from '../src/batcher.js';
import type { EventData } from '../src/types.js';

function makeEvent(overrides?: Partial<EventData>): EventData {
  return {
    eventType: 'test.event',
    eventCategory: 'test',
    severity: 'INFO',
    source: 'test',
    occurredAt: new Date().toISOString(),
    payload: { key: 'value' },
    ...overrides,
  };
}

describe('EventBatcher', () => {
  let onFlush: any;

  beforeEach(() => {
    onFlush = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('adds event to queue', () => {
    const batcher = new EventBatcher({
      batchSize: 10,
      flushIntervalMs: 60000,
      onFlush,
      logger: vi.fn(),
    });
    batcher.add(makeEvent());
    expect(batcher.getQueueSize()).toBe(1);
  });

  it('flushes when batch size threshold reached', async () => {
    const batcher = new EventBatcher({
      batchSize: 3,
      flushIntervalMs: 60000,
      onFlush,
      logger: vi.fn(),
    });
    batcher.add(makeEvent());
    batcher.add(makeEvent());
    batcher.add(makeEvent());

    await new Promise((r) => setTimeout(r, 10));
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toHaveLength(3);
  });

  it('flushes on timer interval', async () => {
    const batcher = new EventBatcher({
      batchSize: 100,
      flushIntervalMs: 50,
      onFlush,
      logger: vi.fn(),
    });
    batcher.start();
    batcher.add(makeEvent());

    await new Promise((r) => setTimeout(r, 100));
    expect(onFlush).toHaveBeenCalledTimes(1);
    batcher.stop();
  });

  it('manual flush works', async () => {
    const batcher = new EventBatcher({
      batchSize: 100,
      flushIntervalMs: 60000,
      onFlush,
      logger: vi.fn(),
    });
    batcher.add(makeEvent());
    await batcher.flush();
    expect(onFlush).toHaveBeenCalledTimes(1);
  });

  it('sends correct payload shape', async () => {
    const batcher = new EventBatcher({
      batchSize: 2,
      flushIntervalMs: 60000,
      onFlush,
      logger: vi.fn(),
    });
    const event = makeEvent();
    batcher.add(event);
    batcher.add(makeEvent());
    await new Promise((r) => setTimeout(r, 10));
    const payload = onFlush.mock.calls[0][0];
    expect(payload[0]).toHaveProperty('eventType');
    expect(payload[0]).toHaveProperty('payload');
  });

  it('does not flush empty batch', async () => {
    const batcher = new EventBatcher({
      batchSize: 10,
      flushIntervalMs: 60000,
      onFlush,
      logger: vi.fn(),
    });
    await batcher.flush();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('shutdown flushes remaining', async () => {
    const batcher = new EventBatcher({
      batchSize: 100,
      flushIntervalMs: 60000,
      onFlush,
      logger: vi.fn(),
    });
    batcher.add(makeEvent());
    batcher.add(makeEvent());
    await batcher.shutdown();
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0]).toHaveLength(2);
  });

  it('handles flush error gracefully', async () => {
    const logger = vi.fn();
    const failFlush = vi.fn().mockRejectedValue(new Error('network error'));
    const batcher = new EventBatcher({
      batchSize: 100,
      flushIntervalMs: 60000,
      onFlush: failFlush,
      logger,
    });
    batcher.add(makeEvent());
    await batcher.flush();
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('Flush failed'),
    );
  });

  describe('rate-limit throttling', () => {
    it('defers flush when remaining < 5', async () => {
      const batcher = new EventBatcher({
        batchSize: 100,
        flushIntervalMs: 60000,
        onFlush,
        logger: vi.fn(),
      });
      batcher.updateRateLimit({ 'x-ratelimit-remaining': '2' });
      batcher.add(makeEvent());

      const start = Date.now();
      await batcher.flush();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(1400);
      expect(onFlush).toHaveBeenCalledTimes(1);
    });

    it('pauses fully on 429, resumes after Retry-After', async () => {
      const batcher = new EventBatcher({
        batchSize: 100,
        flushIntervalMs: 60000,
        onFlush,
        logger: vi.fn(),
      });
      batcher.updateRateLimit({ 'retry-after': '1' });

      const start = Date.now();
      await batcher.flush();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(900);
    });

    it('no delay when remaining >= 5', async () => {
      const batcher = new EventBatcher({
        batchSize: 100,
        flushIntervalMs: 60000,
        onFlush,
        logger: vi.fn(),
      });
      batcher.updateRateLimit({ 'x-ratelimit-remaining': '10' });
      batcher.add(makeEvent());

      const start = Date.now();
      await batcher.flush();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
    });

    it('drops a stale Retry-After pause after it elapses', async () => {
      const batcher = new EventBatcher({
        batchSize: 100,
        flushIntervalMs: 60000,
        onFlush,
        logger: vi.fn(),
      });
      batcher.updateRateLimit({ 'retry-after': '1' });
      await new Promise((r) => setTimeout(r, 1100));
      batcher.add(makeEvent());

      const start = Date.now();
      await batcher.flush();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
      expect(onFlush).toHaveBeenCalledTimes(1);
    });
  });
});
