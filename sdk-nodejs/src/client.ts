// SPDX-License-Identifier: MIT
import { EventBatcher } from './batcher.js';
import { calculateDelay, sleep, isRetryable, parseRetryAfter } from './retry.js';
import {
  buildLogEvent,
  buildMetricEvent,
  buildPerformanceEvent,
  buildSpanEvent,
  type LogData,
  type MetricData,
  type PerformanceData,
  type SpanData,
  type TelemetryCommon,
} from './telemetry.js';
import type {
  EventData,
  SingleResult,
  BulkResult,
  ClientOptions,
} from './types.js';

const SDK_VERSION = '0.1.0';
const SDK_LANGUAGE = 'node';
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const MAX_BULK_SIZE = 500;

export class QuantiqenClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly logger: (msg: string) => void;
  private readonly batcher: EventBatcher;

  constructor(options: ClientOptions) {
    if (!options.apiKey) {
      throw new Error('API key is required');
    }
    if (!options.apiKey.startsWith('qtn_')) {
      throw new Error(
        'Invalid API key format. Expected key starting with "qtn_"',
      );
    }

    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || 'https://api.quantiqen.com').replace(
      /\/$/,
      '',
    );
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = DEFAULT_BASE_DELAY_MS;
    this.logger = options.logger || console.error;

    this.batcher = new EventBatcher({
      batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
      flushIntervalMs: options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      onFlush: (events) => this.sendBulk(events),
      logger: this.logger,
    });

    this.batcher.start();
  }

  async sendEvent(event: EventData): Promise<void> {
    try {
      const enriched = this.enrichEvent(event);
      this.batcher.add(enriched);
    } catch (err) {
      this.logger(
        `[quantiqen-sdk] Failed to enqueue event: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async sendEvents(events: EventData[]): Promise<void> {
    try {
      const enriched = events.map((e) => this.enrichEvent(e));
      for (const event of enriched) {
        this.batcher.add(event);
      }
    } catch (err) {
      this.logger(
        `[quantiqen-sdk] Failed to enqueue events: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async flush(): Promise<void> {
    await this.batcher.flush();
  }

  /** Enqueue a typed metric record (telemetry ingestion). Fire-and-forget. */
  async sendMetric(
    metric: MetricData,
    common: TelemetryCommon,
  ): Promise<void> {
    this.enqueueTelemetry(
      () => buildMetricEvent(metric, common),
      'metric',
    );
  }

  /** Enqueue a typed span/trace record. Fire-and-forget. */
  async sendSpan(span: SpanData, common: TelemetryCommon): Promise<void> {
    this.enqueueTelemetry(() => buildSpanEvent(span, common), 'span');
  }

  /** Enqueue a typed performance record. Fire-and-forget. */
  async sendPerformance(
    performance: PerformanceData,
    common: TelemetryCommon,
  ): Promise<void> {
    this.enqueueTelemetry(
      () => buildPerformanceEvent(performance, common),
      'performance',
    );
  }

  /** Enqueue a typed log/telemetry record. Fire-and-forget. */
  async sendLog(log: LogData, common: TelemetryCommon): Promise<void> {
    this.enqueueTelemetry(() => buildLogEvent(log, common), 'log');
  }

  private enqueueTelemetry(
    build: () => EventData,
    kind: string,
  ): void {
    try {
      this.batcher.add(this.enrichEvent(build()));
    } catch (err) {
      this.logger(
        `[quantiqen-sdk] Failed to enqueue ${kind} telemetry: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async shutdown(): Promise<void> {
    await this.batcher.shutdown();
  }

  updateRateLimit(headers: Record<string, string>): void {
    this.batcher.updateRateLimit(headers);
  }

  private enrichEvent(event: EventData): EventData {
    return {
      ...event,
      metadata: {
        ...event.metadata,
        sdkLanguage: SDK_LANGUAGE,
        sdkVersion: SDK_VERSION,
        userAgent: `quantiqen-sdk-${SDK_LANGUAGE}/${SDK_VERSION}`,
      },
    };
  }

  private async sendBulk(events: EventData[]): Promise<void> {
    const chunks: EventData[][] = [];
    for (let i = 0; i < events.length; i += MAX_BULK_SIZE) {
      chunks.push(events.slice(i, i + MAX_BULK_SIZE));
    }

    for (const chunk of chunks) {
      await this.postWithRetry('/v1/events/bulk', { events: chunk });
    }
  }

  private async postWithRetry(
    path: string,
    body: unknown,
  ): Promise<Response> {
    let lastError: Error | undefined;
    let lastStatus: number | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': this.apiKey,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        });

        this.updateRateLimit(
          Object.fromEntries(response.headers.entries()),
        );

        if (response.ok) {
          return response;
        }

        if (!isRetryable(response.status)) {
          this.logger(
            `[quantiqen-sdk] Non-retryable HTTP ${response.status} from ${path}; dropping batch`,
          );
          return response;
        }

        lastStatus = response.status;
        const retryAfter = parseRetryAfter(
          response.headers.get('retry-after'),
        );
        const delay = calculateDelay(attempt, { maxRetries: this.maxRetries, baseDelayMs: this.baseDelayMs }, retryAfter);
        await sleep(delay);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === this.maxRetries) break;
        const delay = calculateDelay(attempt, {
          maxRetries: this.maxRetries,
          baseDelayMs: this.baseDelayMs,
        });
        await sleep(delay);
      }
    }

    throw lastError ??
      new Error(
        `HTTP ${lastStatus ?? 'request'} failed after ${this.maxRetries + 1} attempts`,
      );
  }
}
