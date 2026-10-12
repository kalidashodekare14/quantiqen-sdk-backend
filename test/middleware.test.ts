import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { testApp, TEST_API_KEY } from './helpers.js';

function okFetch() {
  return vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) =>
        resolve(
          new Response('{}', {
            status: 201,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('X-API-KEY format pre-check', () => {
  it('rejects a missing key with 400 INVALID_API_KEY without touching the upstream', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const app = testApp();
    const res = await request(app)
      .post('/v1/events/bulk')
      .send({ events: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['not-a-key'],
    ['qtn_bad_abc'],
    ['qtn_live_'],
    ['Bearer qtn_live_abc'],
  ])('rejects malformed key %s with 400', async (key) => {
    vi.stubGlobal('fetch', okFetch());

    const app = testApp();
    const res = await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', key)
      .send({ events: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_API_KEY');
  });

  it.each(['qtn_live_abc123', 'qtn_test_abc123', 'qtn_dev_abc123'])(
    'accepts well-formed key %s',
    async (key) => {
      vi.stubGlobal('fetch', okFetch());

      const app = testApp();
      const res = await request(app)
        .post('/v1/events/bulk')
        .set('X-API-KEY', key)
        .send({ events: [] });

      expect(res.status).toBe(201);
    },
  );
});

describe('body limits', () => {
  it('rejects malformed JSON with 400 BAD_REQUEST', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const app = testApp();
    const res = await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', TEST_API_KEY)
      .set('Content-Type', 'application/json')
      .send('{"events":[');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies with 413 PAYLOAD_TOO_LARGE', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const app = testApp({ MAX_BODY_SIZE: '1kb' });
    const res = await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', TEST_API_KEY)
      .set('Content-Type', 'application/json')
      .send({ events: [{ blob: 'x'.repeat(5000) }] });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('edge per-IP rate limit', () => {
  it('returns 429 RATE_LIMITED with Retry-After once the window is exceeded', async () => {
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const app = testApp({ RATE_LIMIT_MAX: 2, RATE_LIMIT_WINDOW_MS: 60000 });

    for (let i = 0; i < 2; i++) {
      const ok = await request(app)
        .post('/v1/events/bulk')
        .set('X-API-KEY', TEST_API_KEY)
        .send({ events: [] });
      expect(ok.status).toBe(201);
    }

    const limited = await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', TEST_API_KEY)
      .send({ events: [] });

    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not rate-limit health probes', async () => {
    vi.stubGlobal('fetch', okFetch());

    const app = testApp({ RATE_LIMIT_MAX: 1, RATE_LIMIT_WINDOW_MS: 60000 });

    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    }
  });
});

describe('CORS', () => {
  it('sends no CORS headers when CORS_ORIGINS is unset', async () => {
    vi.stubGlobal('fetch', okFetch());

    const app = testApp();
    const res = await request(app)
      .post('/v1/events/bulk')
      .set('Origin', 'https://app.example.com')
      .set('X-API-KEY', TEST_API_KEY)
      .send({ events: [] });

    expect(res.status).toBe(201);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows listed origins only', async () => {
    vi.stubGlobal('fetch', okFetch());

    const app = testApp({ CORS_ORIGINS: ['https://app.example.com'] });

    const allowed = await request(app)
      .post('/v1/events/bulk')
      .set('Origin', 'https://app.example.com')
      .set('X-API-KEY', TEST_API_KEY)
      .send({ events: [] });
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://app.example.com',
    );

    const denied = await request(app)
      .post('/v1/events/bulk')
      .set('Origin', 'https://evil.example.com')
      .set('X-API-KEY', TEST_API_KEY)
      .send({ events: [] });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflight without requiring an API key', async () => {
    vi.stubGlobal('fetch', okFetch());

    const app = testApp({ CORS_ORIGINS: ['https://app.example.com'] });
    const res = await request(app)
      .options('/v1/events/bulk')
      .set('Origin', 'https://app.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect([204, 200]).toContain(res.status);
    expect(res.headers['access-control-allow-origin']).toBe(
      'https://app.example.com',
    );
  });
});

describe('request id + error envelope', () => {
  it('echoes a valid inbound X-Request-Id', async () => {
    vi.stubGlobal('fetch', okFetch());

    const app = testApp();
    const res = await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', TEST_API_KEY)
      .set('X-Request-Id', 'client-req-123')
      .send({ events: [] });

    expect(res.headers['x-request-id']).toBe('client-req-123');
  });

  it('replaces a malformed inbound X-Request-Id with a generated one', async () => {
    vi.stubGlobal('fetch', okFetch());

    const app = testApp();
    const res = await request(app)
      .post('/v1/events/bulk')
      .set('X-API-KEY', TEST_API_KEY)
      .set('X-Request-Id', 'bad id with spaces!!')
      .send({ events: [] });

    expect(res.headers['x-request-id']).not.toBe('bad id with spaces!!');
    expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
  });

  it('produces the platform envelope on 404', async () => {
    const app = testApp();
    const res = await request(app).get('/nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.request_id).toBe(res.headers['x-request-id']);
    expect(typeof res.body.error.message).toBe('string');
  });
});
