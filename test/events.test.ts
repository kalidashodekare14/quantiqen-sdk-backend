import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { testApp, TEST_API_KEY } from './helpers.js';

const bulkPayload = {
  events: [
    { type: 'auth.login', timestamp: '2026-01-01T00:00:00Z', metadata: {} },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /v1/events/bulk', () => {
  it('proxies to the platform with mapped path, headers and body; passes 201 through untouched', async () => {
    const upstreamBody = {
      results: [{ index: 0, status: 'accepted', event_id: 'evt_1' }],
      acceptedCount: 1,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(upstreamBody), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const app = testApp();
    const res = await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', TEST_API_KEY)
      .set('Content-Type', 'application/json')
      .send(bulkPayload);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(upstreamBody);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://upstream.test/api/v1/events/bulk');
    expect(init.method).toBe('POST');
    expect(init.headers['X-API-KEY']).toBe(TEST_API_KEY);
    expect(typeof init.headers['X-Request-Id']).toBe('string');
    expect(init.headers['X-Request-Id'].length).toBeGreaterThan(0);
    expect(JSON.parse(Buffer.from(init.body as Uint8Array).toString('utf8'))).toEqual(bulkPayload);
  });

  it('strips inbound headers outside the allow-list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const app = testApp();
    await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', TEST_API_KEY)
      .set('X-Evil-Header', 'should-not-forward')
      .set('Cookie', 'session=abc')
      .send(bulkPayload);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-Evil-Header']).toBeUndefined();
    expect(init.headers['Cookie']).toBeUndefined();
  });

  it('sends X-Internal-Proxy-Secret from config when set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const app = testApp({ INTERNAL_PROXY_SECRET: 's3cret' });
    await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', TEST_API_KEY)
      .send(bulkPayload);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-Internal-Proxy-Secret']).toBe('s3cret');
  });

  it('strips an inbound spoofed X-Internal-Proxy-Secret (config secret wins)', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response('{}', { status: 201 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const app = testApp({ INTERNAL_PROXY_SECRET: 'config-secret' });
    await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', TEST_API_KEY)
      .set('X-Internal-Proxy-Secret', 'caller-secret')
      .send(bulkPayload);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-Internal-Proxy-Secret']).toBe('config-secret');
  });

  it('passes 422 validation envelopes through untouched', async () => {
    const upstreamBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'One or more events failed validation',
        request_id: 'req_platform',
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(upstreamBody), {
            status: 422,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );

    const app = testApp();
    const res = await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', TEST_API_KEY)
      .send(bulkPayload);

    expect(res.status).toBe(422);
    expect(res.body).toEqual(upstreamBody);
  });

  it('passes 429 through with the Retry-After header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 'RATE_LIMITED', message: 'slow down', request_id: 'r' },
            }),
            { status: 429, headers: { 'retry-after': '7', 'content-type': 'application/json' } },
          ),
        ),
      ),
    );

    const app = testApp();
    const res = await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', TEST_API_KEY)
      .send(bulkPayload);

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('7');
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('passes 500 through without retrying the upstream POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'INTERNAL_SERVER_ERROR', message: 'boom', request_id: 'r' },
        }),
        { status: 500 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const app = testApp();
    const res = await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', TEST_API_KEY)
      .send(bulkPayload);

    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps an upstream timeout to 504 UPSTREAM_TIMEOUT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('timed out', 'TimeoutError')),
            );
          }),
      ),
    );

    const app = testApp({ REQUEST_TIMEOUT_MS: 50 });
    const res = await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', TEST_API_KEY)
      .send(bulkPayload);

    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('UPSTREAM_TIMEOUT');
    expect(res.body.error.request_id).toBe(res.headers['x-request-id']);
  });

  it('maps an upstream connection failure to 503 UPSTREAM_UNAVAILABLE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    );

    const app = testApp();
    const res = await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', TEST_API_KEY)
      .send(bulkPayload);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('UPSTREAM_UNAVAILABLE');
  });
});

describe('POST /v1/events', () => {
  it('proxies the single-event path to /api/v1/events', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const app = testApp();
    const res = await request(app)
      .post('/v1/events')
      .set('X-API-KEY', TEST_API_KEY)
      .send({ type: 'auth.login', metadata: {} });

    expect(res.status).toBe(201);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://upstream.test/api/v1/events',
    );
  });
});
