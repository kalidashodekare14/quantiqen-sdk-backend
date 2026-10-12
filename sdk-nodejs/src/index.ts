// SPDX-License-Identifier: MIT
export { QuantiqenClient } from './client.js';
export type {
  EventData,
  Severity,
  SingleResult,
  BulkItemResult,
  BulkResult,
  ClientOptions,
} from './types.js';
export {
  TELEMETRY_CATEGORY,
  buildMetricEvent,
  buildSpanEvent,
  buildPerformanceEvent,
  buildLogEvent,
} from './telemetry.js';
export type {
  TelemetryType,
  TelemetryCommon,
  TelemetryLogLevel,
  MetricKind,
  MetricData,
  SpanKind,
  SpanStatus,
  SpanData,
  SpanEventData,
  PerformanceStatus,
  PerformanceData,
  LogData,
  LabelValue,
} from './telemetry.js';
