// SPDX-License-Identifier: MIT
import { randomUUID } from 'node:crypto';
import type { EventData, Severity } from './types.js';

/**
 * Telemetry conventions — typed models that ride the existing
 * `POST /v1/events[/bulk]` envelope (the platform's CreateEventDto is the
 * wire contract; payload is free-form JSONB). Records carry a discriminated
 * `payload.telemetryType` plus exactly one of metric/span/performance/log.
 *
 * Builders validate strictly and throw on malformed input (programming
 * errors, like the client constructor throwing on a bad API key). The
 * client's send* helpers catch and log instead — fire-and-forget.
 */

export const TELEMETRY_CATEGORY = 'telemetry';

export type TelemetryType = 'metric' | 'span' | 'performance' | 'log';

export type MetricKind = 'counter' | 'gauge' | 'histogram' | 'distribution';
export type SpanKind =
  | 'internal'
  | 'server'
  | 'client'
  | 'producer'
  | 'consumer';
export type SpanStatus = 'ok' | 'error' | 'unset';
export type PerformanceStatus = 'ok' | 'error';
export type TelemetryLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type LabelValue = string | number | boolean;

export interface MetricData {
  name: string;
  kind: MetricKind;
  value?: number;
  values?: number[];
  unit?: string;
  labels?: Record<string, LabelValue>;
}

export interface SpanEventData {
  name: string;
  time: string;
  attributes?: Record<string, unknown>;
}

export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  status?: SpanStatus;
  attributes?: Record<string, unknown>;
  events?: SpanEventData[];
}

export interface PerformanceData {
  operation: string;
  durationMs: number;
  status?: PerformanceStatus;
  throughputPerSec?: number;
  errorRate?: number;
  resource?: string;
  dimensions?: Record<string, LabelValue>;
}

export interface LogData {
  level: TelemetryLogLevel;
  message: string;
  attributes?: Record<string, unknown>;
}

export interface TelemetryCommon {
  source: string;
  occurredAt?: string;
  severity?: Severity;
  assetId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

const METRIC_KINDS: ReadonlySet<string> = new Set([
  'counter',
  'gauge',
  'histogram',
  'distribution',
]);
const SPAN_KINDS: ReadonlySet<string> = new Set([
  'internal',
  'server',
  'client',
  'producer',
  'consumer',
]);
const SPAN_STATUSES: ReadonlySet<string> = new Set(['ok', 'error', 'unset']);
const LOG_LEVELS: ReadonlySet<string> = new Set([
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
]);

const LOG_LEVEL_SEVERITY: Record<TelemetryLogLevel, Severity> = {
  debug: 'INFO',
  info: 'INFO',
  warn: 'MEDIUM',
  error: 'HIGH',
  fatal: 'CRITICAL',
};

const HEX_ID = /^[0-9a-fA-F]+$/;

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function requireFinite(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}

function requireIsoDate(value: string, field: string): string {
  requireNonEmpty(value, field);
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO 8601 timestamp`);
  }
  return value;
}

function baseEvent(
  telemetryType: TelemetryType,
  eventType: string,
  payload: Record<string, unknown>,
  common: TelemetryCommon,
): EventData {
  requireNonEmpty(common.source, 'source');
  return {
    eventType,
    eventCategory: TELEMETRY_CATEGORY,
    severity: common.severity ?? 'INFO',
    source: common.source,
    occurredAt: common.occurredAt ?? new Date().toISOString(),
    eventVersion: '1.0',
    idempotencyKey: common.idempotencyKey ?? randomUUID(),
    payload: { telemetryType, ...payload },
    metadata: common.metadata,
    ...(common.assetId !== undefined ? { assetId: common.assetId } : {}),
  };
}

export function buildMetricEvent(
  metric: MetricData,
  common: TelemetryCommon,
): EventData {
  requireNonEmpty(metric.name, 'metric.name');
  if (!METRIC_KINDS.has(metric.kind)) {
    throw new Error(
      `metric.kind must be one of: ${[...METRIC_KINDS].join(', ')}`,
    );
  }
  if (metric.kind === 'counter' || metric.kind === 'gauge') {
    if (metric.value === undefined) {
      throw new Error(`metric.value is required for kind "${metric.kind}"`);
    }
    requireFinite(metric.value, 'metric.value');
  } else {
    if (
      !Array.isArray(metric.values) ||
      metric.values.length === 0 ||
      !metric.values.every((v) => typeof v === 'number' && Number.isFinite(v))
    ) {
      throw new Error(
        `metric.values must be a non-empty array of finite numbers for kind "${metric.kind}"`,
      );
    }
  }
  if (metric.value !== undefined) {
    requireFinite(metric.value, 'metric.value');
  }

  const data: Record<string, unknown> = { name: metric.name, kind: metric.kind };
  if (metric.value !== undefined) data.value = metric.value;
  if (metric.values !== undefined) data.values = metric.values;
  if (metric.unit !== undefined) data.unit = metric.unit;
  if (metric.labels !== undefined) data.labels = metric.labels;

  return baseEvent('metric', 'telemetry.metric', { metric: data }, common);
}

export function buildSpanEvent(
  span: SpanData,
  common: TelemetryCommon,
): EventData {
  requireNonEmpty(span.traceId, 'span.traceId');
  if (!HEX_ID.test(span.traceId)) {
    throw new Error('span.traceId must be hexadecimal');
  }
  requireNonEmpty(span.spanId, 'span.spanId');
  if (!HEX_ID.test(span.spanId)) {
    throw new Error('span.spanId must be hexadecimal');
  }
  if (span.parentSpanId !== undefined && !HEX_ID.test(span.parentSpanId)) {
    throw new Error('span.parentSpanId must be hexadecimal');
  }
  requireNonEmpty(span.name, 'span.name');
  if (!SPAN_KINDS.has(span.kind)) {
    throw new Error(`span.kind must be one of: ${[...SPAN_KINDS].join(', ')}`);
  }
  requireIsoDate(span.startTime, 'span.startTime');
  if (span.endTime !== undefined) {
    requireIsoDate(span.endTime, 'span.endTime');
  }
  if (span.durationMs !== undefined) {
    requireFinite(span.durationMs, 'span.durationMs');
    if (span.durationMs < 0) {
      throw new Error('span.durationMs must be >= 0');
    }
  }
  const status = span.status ?? 'unset';
  if (!SPAN_STATUSES.has(status)) {
    throw new Error(
      `span.status must be one of: ${[...SPAN_STATUSES].join(', ')}`,
    );
  }

  const data: Record<string, unknown> = {
    traceId: span.traceId,
    spanId: span.spanId,
    name: span.name,
    kind: span.kind,
    startTime: span.startTime,
    status,
  };
  if (span.parentSpanId !== undefined) data.parentSpanId = span.parentSpanId;
  if (span.endTime !== undefined) data.endTime = span.endTime;
  if (span.durationMs !== undefined) data.durationMs = span.durationMs;
  if (span.attributes !== undefined) data.attributes = span.attributes;
  if (span.events !== undefined) {
    for (const [i, ev] of span.events.entries()) {
      requireNonEmpty(ev.name, `span.events[${i}].name`);
      requireIsoDate(ev.time, `span.events[${i}].time`);
    }
    data.events = span.events;
  }

  return baseEvent('span', 'telemetry.span', { span: data }, common);
}

export function buildPerformanceEvent(
  performance: PerformanceData,
  common: TelemetryCommon,
): EventData {
  requireNonEmpty(performance.operation, 'performance.operation');
  requireFinite(performance.durationMs, 'performance.durationMs');
  if (performance.durationMs < 0) {
    throw new Error('performance.durationMs must be >= 0');
  }
  if (
    performance.status !== undefined &&
    performance.status !== 'ok' &&
    performance.status !== 'error'
  ) {
    throw new Error('performance.status must be "ok" or "error"');
  }
  if (performance.throughputPerSec !== undefined) {
    requireFinite(performance.throughputPerSec, 'performance.throughputPerSec');
    if (performance.throughputPerSec < 0) {
      throw new Error('performance.throughputPerSec must be >= 0');
    }
  }
  if (performance.errorRate !== undefined) {
    requireFinite(performance.errorRate, 'performance.errorRate');
    if (performance.errorRate < 0 || performance.errorRate > 1) {
      throw new Error('performance.errorRate must be between 0 and 1');
    }
  }

  const data: Record<string, unknown> = {
    operation: performance.operation,
    durationMs: performance.durationMs,
  };
  if (performance.status !== undefined) data.status = performance.status;
  if (performance.throughputPerSec !== undefined) {
    data.throughputPerSec = performance.throughputPerSec;
  }
  if (performance.errorRate !== undefined) data.errorRate = performance.errorRate;
  if (performance.resource !== undefined) data.resource = performance.resource;
  if (performance.dimensions !== undefined) {
    data.dimensions = performance.dimensions;
  }

  return baseEvent(
    'performance',
    'telemetry.performance',
    { performance: data },
    common,
  );
}

export function buildLogEvent(
  log: LogData,
  common: TelemetryCommon,
): EventData {
  if (!LOG_LEVELS.has(log.level)) {
    throw new Error(`log.level must be one of: ${[...LOG_LEVELS].join(', ')}`);
  }
  requireNonEmpty(log.message, 'log.message');

  const data: Record<string, unknown> = { level: log.level, message: log.message };
  if (log.attributes !== undefined) data.attributes = log.attributes;

  return baseEvent(
    'log',
    'telemetry.log',
    { log: data },
    {
      ...common,
      severity: common.severity ?? LOG_LEVEL_SEVERITY[log.level],
    },
  );
}
