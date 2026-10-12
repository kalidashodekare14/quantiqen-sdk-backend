import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { testApp } from './helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /health', () => {
  it('returns 200 with status ok and uptime', async () => {
    const app = testApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime_s).toBe('number');
  });

  it('works without an injected logger', async () => {
    const { createApp } = await import('../src/app.js');
    const { testConfig } = await import('./helpers.js');
    const app = createApp(testConfig());
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
  });
});

describe('GET /ready', () => {
  it('returns 200 when the platform health endpoint is reachable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const app = testApp();
    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://upstream.test/api/v1/health',
    );
  });

  it('returns 503 when the platform health endpoint is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('down', { status: 503 })),
    );

    const app = testApp();
    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });

  it('returns 503 when the platform is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    );

    const app = testApp();
    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });
});
