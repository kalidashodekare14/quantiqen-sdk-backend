// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuantiqenClient } from '../src/client.js';
import {
  buildMetricEvent,
  buildSpanEvent,
  buildPerformanceEvent,
  buildLogEvent,
  TELEMETRY_CATEGORY,
  type TelemetryCommon,
} from '../src/telemetry.js';

const VALID_KEY = 'qtn_live_abc123def456ghi789jkl012mno345pqr';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const common: TelemetryCommon = { source: 'my-service' };

describe('buildMetricEvent', () => {
  it('builds a valid counter event with conventions applied', () => {
    const event = buildMetricEvent(
      {
        name: 'http.requests',
        kind: 'counter',
        value: 1,
        unit: 'count',
        labels: { route: '/users', method: 'GET' },
      },
      common,
    );

    expect(event.eventType).toBe('telemetry.metric');
    expect(event.eventCategory).toBe(TELEMETRY_CATEGORY);
    expect(event.severity).toBe('INFO');
    expect(event.source).toBe('my-service');
    expect(event.idempotencyKey).toMatch(UUID_RE);
    expect(typeof event.occurredAt).toBe('string');
    expect(event.payload).toEqual({
      telemetryType: 'metric',
      metric: {
        name: 'http.requests',
        kind: 'counter',
        value: 1,
        unit: 'count',
        labels: { route: '/users', method: 'GET' },
      },
    });
  });

  it('builds a histogram with values array', () => {
    const event = buildMetricEvent(
      { name: 'db.query.duration', kind: 'histogram', values: [12.5, 40, 8] },
      common,
    );
    const metric = (event.payload as { metric: { values: number[] } }).metric;
    expect(metric.values).toEqual([12.5, 40, 8]);
  });

  it('honors explicit occurredAt, severity and idempotencyKey', () => {
    const event = buildMetricEvent(
      { name: 'cpu.usage', kind: 'gauge', value: 0.73 },
      {
        source: 'host-1',
        occurredAt: '2026-01-01T00:00:00.000Z',
        severity: 'LOW',
        idempotencyKey: 'custom-key-1',
        assetId: 'asset-uuid',
      },
    );
    expect(event.occurredAt).toBe('2026-01-01T00:00:00.000Z');
    expect(event.severity).toBe('LOW');
    expect(event.idempotencyKey).toBe('custom-key-1');
    expect(event.assetId).toBe('asset-uuid');
  });

  it.each([
    [{ name: '', kind: 'counter', value: 1 }, 'metric.name'],
    [{ name: 'm', kind: 'nope' as never, value: 1 }, 'metric.kind'],
    [{ name: 'm', kind: 'counter' }, 'metric.value is required'],
    [{ name: 'm', kind: 'histogram' }, 'metric.values'],
    [{ name: 'm', kind: 'gauge', value: NaN }, 'metric.value'],
    [{ name: 'm', kind: 'distribution', values: [1, 'x' as never] }, 'metric.values'],
  ])('rejects invalid metric %#', (metric, message) => {
    expect(() => buildMetricEvent(metric as never, common)).toThrow(
      new RegExp(message as string),
    );
  });

  it('requires source', () => {
    expect(() =>
      buildMetricEvent(
        { name: 'm', kind: 'gauge', value: 1 },
        { source: '' },
      ),
    ).toThrow('source is required');
  });
});

describe('buildSpanEvent', () => {
  const validSpan = {
    traceId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    spanId: '0123456789abcdef',
    name: 'GET /users',
    kind: 'server' as const,
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2026-01-01T00:00:00.120Z',
    durationMs: 120,
    status: 'ok' as const,
    attributes: { 'http.status_code': 200 },
  };

  it('builds a valid span with default status unset', () => {
    const event = buildSpanEvent(
      { ...validSpan, status: undefined },
      common,
    );
    const span = (
      event.payload as { span: { status: string; parentSpanId?: string } }
    ).span;
    expect(span.status).toBe('unset');
    expect(span.parentSpanId).toBeUndefined();
    expect(event.eventType).toBe('telemetry.span');
  });

  it('accepts parentSpanId and span events', () => {
    const event = buildSpanEvent(
      {
        ...validSpan,
        parentSpanId: 'fedcba9876543210',
        events: [
          { name: 'exception', time: '2026-01-01T00:00:00.100Z' },
        ],
      },
      common,
    );
    const span = (
      event.payload as {
        span: { parentSpanId: string; events: unknown[] };
      }
    ).span;
    expect(span.parentSpanId).toBe('fedcba9876543210');
    expect(span.events).toHaveLength(1);
  });

  it.each([
    [{ ...validSpan, traceId: '' }, 'span.traceId is required'],
    [{ ...validSpan, traceId: 'zzzz' }, 'span.traceId must be hexadecimal'],
    [{ ...validSpan, spanId: 'nothex!!' }, 'span.spanId must be hexadecimal'],
    [{ ...validSpan, name: '' }, 'span.name is required'],
    [{ ...validSpan, kind: 'weird' as never }, 'span.kind'],
    [{ ...validSpan, startTime: 'not-a-date' }, 'span.startTime'],
    [{ ...validSpan, durationMs: -1 }, 'span.durationMs must be >= 0'],
    [{ ...validSpan, status: 'meh' as never }, 'span.status'],
  ])('rejects invalid span %#', (span, message) => {
    expect(() => buildSpanEvent(span as never, common)).toThrow(
      new RegExp(message as string),
    );
  });
});

describe('buildPerformanceEvent', () => {
  it('builds a valid performance event', () => {
    const event = buildPerformanceEvent(
      {
        operation: 'POST /checkout',
        durationMs: 842.5,
        status: 'ok',
        throughputPerSec: 120,
        errorRate: 0.01,
        resource: 'checkout-service',
        dimensions: { region: 'eu-west-1' },
      },
      common,
    );
    expect(event.eventType).toBe('telemetry.performance');
    expect(event.payload).toMatchObject({
      telemetryType: 'performance',
      performance: { operation: 'POST /checkout', durationMs: 842.5 },
    });
  });

  it.each([
    [{ operation: '', durationMs: 1 }, 'performance.operation'],
    [{ operation: 'op', durationMs: -5 }, 'performance.durationMs must be >= 0'],
    [{ operation: 'op', durationMs: 1, status: 'meh' as never }, 'performance.status'],
    [{ operation: 'op', durationMs: 1, errorRate: 1.5 }, 'performance.errorRate'],
    [{ operation: 'op', durationMs: 1, throughputPerSec: -1 }, 'performance.throughputPerSec'],
  ])('rejects invalid performance %#', (perf, message) => {
    expect(() => buildPerformanceEvent(perf as never, common)).toThrow(
      new RegExp(message as string),
    );
  });
});

describe('buildLogEvent', () => {
  it('builds a log event and maps level to severity', () => {
    const event = buildLogEvent(
      { level: 'error', message: 'checkout failed', attributes: { orderId: 'o-1' } },
      common,
    );
    expect(event.severity).toBe('HIGH');
    expect(event.eventType).toBe('telemetry.log');
    expect(event.payload).toEqual({
      telemetryType: 'log',
      log: { level: 'error', message: 'checkout failed', attributes: { orderId: 'o-1' } },
    });
  });

  it.each([
    ['debug', 'INFO'],
    ['info', 'INFO'],
    ['warn', 'MEDIUM'],
    ['error', 'HIGH'],
    ['fatal', 'CRITICAL'],
  ] as const)('maps level %s to severity %s', (level, severity) => {
    const event = buildLogEvent({ level, message: 'x' }, common);
    expect(event.severity).toBe(severity);
  });

  it('rejects invalid level and empty message', () => {
    expect(() =>
      buildLogEvent({ level: 'verbose' as never, message: 'x' }, common),
    ).toThrow('log.level');
    expect(() =>
      buildLogEvent({ level: 'info', message: '' }, common),
    ).toThrow('log.message is required');
  });
});

describe('client telemetry methods', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sendMetric enqueues a bulk payload with telemetry conventions', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: () => Promise.resolve({}),
    });
    global.fetch = fetchMock;

    const client = new QuantiqenClient({
      apiKey: VALID_KEY,
      batchSize: 100,
      flushIntervalMs: 60000,
    });

    await client.sendMetric(
      { name: 'http.requests', kind: 'counter', value: 1 },
      { source: 'api' },
    );
    await client.flush();

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    const event = body.events[0];
    expect(event.eventCategory).toBe('telemetry');
    expect(event.eventType).toBe('telemetry.metric');
    expect(event.idempotencyKey).toMatch(UUID_RE);
    expect(event.payload.telemetryType).toBe('metric');
    expect(event.metadata.sdkLanguage).toBe('node');
    expect(event.metadata.sdkVersion).toBe('0.1.0');
  });

  it('sendLog and sendSpan flow through the same bulk path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers(),
      json: () => Promise.resolve({}),
    });
    global.fetch = fetchMock;

    const client = new QuantiqenClient({
      apiKey: VALID_KEY,
      batchSize: 100,
      flushIntervalMs: 60000,
    });

    await client.sendLog(
      { level: 'warn', message: 'slow query' },
      { source: 'db' },
    );
    await client.sendSpan(
      {
        traceId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
        spanId: '0123456789abcdef',
        name: 'db.query',
        kind: 'client',
        startTime: '2026-01-01T00:00:00.000Z',
      },
      { source: 'db' },
    );
    await client.flush();

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.events).toHaveLength(2);
    expect(body.events[0].payload.telemetryType).toBe('log');
    expect(body.events[0].severity).toBe('MEDIUM');
    expect(body.events[1].payload.telemetryType).toBe('span');
    expect(body.events[1].idempotencyKey).toMatch(UUID_RE);
  });

  it('logs and swallows invalid telemetry input (never throws)', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    const logger = vi.fn();
    const client = new QuantiqenClient({
      apiKey: VALID_KEY,
      batchSize: 100,
      flushIntervalMs: 60000,
      logger,
    });

    await expect(
      client.sendMetric({ name: '', kind: 'counter', value: 1 }, { source: 'x' }),
    ).resolves.toBeUndefined();

    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining('Failed to enqueue metric telemetry'),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
