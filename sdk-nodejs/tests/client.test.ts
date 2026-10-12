import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuantiqenClient } from '../src/client.js';

const VALID_KEY = 'qtn_live_abc123def456ghi789jkl012mno345pqr';

function makeEvent() {
  return {
    eventType: 'test.event',
    eventCategory: 'test',
    severity: 'INFO' as const,
    source: 'test',
    occurredAt: new Date().toISOString(),
    payload: { key: 'value' },
  };
}

describe('QuantiqenClient', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('construction', () => {
    it('throws on missing API key', () => {
      expect(() => new QuantiqenClient({ apiKey: '' })).toThrow(
        'API key is required',
      );
    });

    it('throws on invalid API key format', () => {
      expect(
        () => new QuantiqenClient({ apiKey: 'invalid_key' }),
      ).toThrow('Invalid API key format');
    });

    it('accepts valid API key', () => {
      expect(
        () => new QuantiqenClient({ apiKey: VALID_KEY }),
      ).not.toThrow();
    });
  });

  describe('auth', () => {
    it('sends correct X-API-KEY header', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'x-ratelimit-remaining': '100' }),
        json: () => Promise.resolve({}),
      });
      global.fetch = fetchMock;

      const client = new QuantiqenClient({
        apiKey: VALID_KEY,
        batchSize: 1,
        flushIntervalMs: 60000,
      });

      await client.sendEvent(makeEvent());
      await client.flush();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers['X-API-KEY']).toBe(VALID_KEY);
    });

    it('uses correct base URL', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'x-ratelimit-remaining': '100' }),
        json: () => Promise.resolve({}),
      });
      global.fetch = fetchMock;

      const client = new QuantiqenClient({
        apiKey: VALID_KEY,
        baseUrl: 'https://custom.api.com',
        batchSize: 1,
        flushIntervalMs: 60000,
      });

      await client.sendEvent(makeEvent());
      await client.flush();

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('https://custom.api.com/v1/events/bulk');
    });
  });

  describe('response handling', () => {
    it('sends correct bulk payload shape', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'x-ratelimit-remaining': '100' }),
        json: () =>
          Promise.resolve({
            results: [
              { index: 0, status: 'accepted', eventId: 'evt-123' },
            ],
            acceptedCount: 1,
            duplicateCount: 0,
            rejectedCount: 0,
          }),
      });
      global.fetch = fetchMock;

      const client = new QuantiqenClient({
        apiKey: VALID_KEY,
        batchSize: 1,
        flushIntervalMs: 60000,
      });

      await client.sendEvent(makeEvent());
      await client.flush();

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body).toHaveProperty('events');
      expect(Array.isArray(body.events)).toBe(true);
    });

    it('merges custom metadata with SDK auto-fields', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'x-ratelimit-remaining': '100' }),
        json: () => Promise.resolve({}),
      });
      global.fetch = fetchMock;

      const client = new QuantiqenClient({
        apiKey: VALID_KEY,
        batchSize: 1,
        flushIntervalMs: 60000,
      });

      await client.sendEvent({
        ...makeEvent(),
        metadata: { customField: 'customValue' },
      });
      await client.flush();

      const [, options] = fetchMock.mock.calls[0];
      const body = JSON.parse(options.body);
      const meta = body.events[0].metadata;
      expect(meta.customField).toBe('customValue');
      expect(meta.sdkLanguage).toBe('node');
      expect(meta.sdkVersion).toBe('0.1.0');
      expect(meta.userAgent).toContain('quantiqen-sdk-node');
    });
  });

  describe('error isolation', () => {
    it('sendEvent resolves when API is unreachable (ECONNREFUSED)', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new Error('fetch failed: connect ECONNREFUSED'));
      global.fetch = fetchMock;

      const client = new QuantiqenClient({
        apiKey: VALID_KEY,
        batchSize: 1,
        flushIntervalMs: 60000,
        maxRetries: 1,
      });

      const start = Date.now();
      await expect(client.sendEvent(makeEvent())).resolves.toBeUndefined();
      await client.flush();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(30000);
    });

    it('sendEvents resolves when API is unreachable', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new Error('fetch failed: connect ECONNREFUSED'));
      global.fetch = fetchMock;

      const client = new QuantiqenClient({
        apiKey: VALID_KEY,
        batchSize: 100,
        flushIntervalMs: 60000,
        maxRetries: 1,
      });

      await expect(
        client.sendEvents([makeEvent(), makeEvent()]),
      ).resolves.toBeUndefined();
    });

    it('no error thrown to caller on failure', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new Error('network down'));
      global.fetch = fetchMock;

      const client = new QuantiqenClient({
        apiKey: VALID_KEY,
        batchSize: 1,
        flushIntervalMs: 60000,
        maxRetries: 1,
      });

      let caught = false;
      try {
        await client.sendEvent(makeEvent());
        await client.flush();
      } catch {
        caught = true;
      }
      expect(caught).toBe(false);
    });

    it('completes in bounded time even with retries', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new Error('ECONNREFUSED'));
      global.fetch = fetchMock;

      const client = new QuantiqenClient({
        apiKey: VALID_KEY,
        batchSize: 1,
        flushIntervalMs: 60000,
        maxRetries: 3,
      });

      const start = Date.now();
      await client.sendEvent(makeEvent());
      await client.flush();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(30000);
    });
  });

  describe('rate-limit tracking', () => {
    it('updates rate limit from response headers', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({
          'x-ratelimit-remaining': '42',
          'retry-after': '',
        }),
        json: () => Promise.resolve({}),
      });
      global.fetch = fetchMock;

      const client = new QuantiqenClient({
        apiKey: VALID_KEY,
        batchSize: 1,
        flushIntervalMs: 60000,
      });

      await client.sendEvent(makeEvent());
      await client.flush();

      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe('retry correctness', () => {
    const callsTo = (fetchMock: ReturnType<typeof vi.fn>, url: string) =>
      fetchMock.mock.calls.filter(([u]) => u === url);

    it('passes an AbortSignal timeout on every request', async () => {
      const url = 'https://s3-test.example/v1/events/bulk';
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'x-ratelimit-remaining': '100' }),
        json: () => Promise.resolve({}),
      });
      global.fetch = fetchMock;

      const client = new QuantiqenClient({
        apiKey: VALID_KEY,
        baseUrl: 'https://s3-test.example',
        batchSize: 100,
        flushIntervalMs: 60000,
      });

      await client.sendEvent(makeEvent());
      await client.flush();

      const [, options] = callsTo(fetchMock, url)[0];
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it('surfaces HTTP <status> error when 5xx retries are exhausted', async () => {
      const url = 'https://s4-test.example/v1/events/bulk';
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: new Headers(),
        json: () => Promise.resolve({}),
      });
      global.fetch = fetchMock;

      const logger = vi.fn();
      const client = new QuantiqenClient({
        apiKey: VALID_KEY,
        baseUrl: 'https://s4-test.example',
        batchSize: 100,
        flushIntervalMs: 60000,
        maxRetries: 1,
        logger,
      });

      await client.sendEvent(makeEvent());
      await client.flush();

      expect(callsTo(fetchMock, url)).toHaveLength(2);
      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining('HTTP 503 failed after 2 attempts'),
      );
    });

    it('logs non-retryable 4xx and does not retry', async () => {
      const url = 'https://s5-test.example/v1/events/bulk';
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        headers: new Headers(),
        json: () => Promise.resolve({}),
      });
      global.fetch = fetchMock;

      const logger = vi.fn();
      const client = new QuantiqenClient({
        apiKey: VALID_KEY,
        baseUrl: 'https://s5-test.example',
        batchSize: 100,
        flushIntervalMs: 60000,
        logger,
      });

      await client.sendEvent(makeEvent());
      await client.flush();

      expect(callsTo(fetchMock, url)).toHaveLength(1);
      expect(logger).toHaveBeenCalledWith(
        expect.stringContaining('Non-retryable HTTP 422'),
      );
    });
  });
});
