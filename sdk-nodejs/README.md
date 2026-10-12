# QUANTIQEN SDK for Node.js

Thin client for ingesting telemetry events into the QUANTIQEN Security Decision Intelligence platform.

Wraps `POST /v1/events` and `POST /v1/events/bulk` with client-side batching, automatic retry with exponential backoff, and proactive rate-limit-aware throttling.

## Quickstart

```bash
npm install @quantiqen/sdk
```

```typescript
import { QuantiqenClient } from '@quantiqen/sdk';

const client = new QuantiqenClient({
  apiKey: 'qtn_live_your_api_key_here',
  baseUrl: 'https://api.quantiqen.com',  // optional, this is the default
});

// Send a single event (fire-and-forget, never blocks)
await client.sendEvent({
  eventType: 'auth.login',
  eventCategory: 'authentication',
  severity: 'MEDIUM',
  source: 'my-app',
  occurredAt: new Date().toISOString(),
  payload: {
    userId: 'user-123',
    ip: '192.168.1.1',
    success: true,
  },
});

// Send multiple events
await client.sendEvents([
  {
    eventType: 'api.request',
    eventCategory: 'api',
    severity: 'LOW',
    source: 'my-api',
    occurredAt: new Date().toISOString(),
    payload: { method: 'GET', path: '/users', status: 200 },
  },
  {
    eventType: 'db.slow_query',
    eventCategory: 'database',
    severity: 'HIGH',
    source: 'my-db',
    occurredAt: new Date().toISOString(),
    payload: { query: 'SELECT * FROM users', duration_ms: 5000 },
  },
]);

// Manually flush pending events (optional)
await client.flush();

// Graceful shutdown — flush pending events before process exits
process.on('SIGTERM', () => client.shutdown());
process.on('SIGINT', () => client.shutdown());
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `apiKey` | (required) | Your QUANTIQEN API key (`qtn_live_*` or `qtn_test_*`) |
| `baseUrl` | `https://api.quantiqen.com` | Backend API URL |
| `batchSize` | `100` | Events accumulated before auto-flush |
| `flushIntervalMs` | `5000` | Max time (ms) between flushes |
| `maxRetries` | `3` | Max retry attempts on transient failures |
| `logger` | `console.error` | Log function for SDK errors |

## How It Works

1. **Batching**: Events are accumulated in memory. When the batch reaches `batchSize` or `flushIntervalMs` elapses (whichever comes first), the batch is flushed to the backend via `POST /v1/events/bulk`.

2. **Retry with backoff**: Transient failures (network errors, 5xx, 429) are retried up to `maxRetries` times with exponential backoff (1s, 2s, 4s) plus jitter. The SDK respects `Retry-After` headers from 429 responses.

3. **Rate-limit awareness**: The SDK tracks `X-RateLimit-Remaining` from responses. When remaining is low (< 5), flushes are proactively delayed to avoid hitting the rate limit.

4. **Error isolation**: `sendEvent()` and `sendEvents()` always resolve — they never reject or throw. Failures are logged internally. This guarantees the SDK never crashes your application.

5. **SDK metadata**: Events are automatically enriched with `sdkLanguage`, `sdkVersion`, and `userAgent` metadata fields (merged with any custom metadata you provide).

## Graceful Shutdown

Call `shutdown()` during process shutdown to flush any pending events:

```typescript
process.on('SIGTERM', async () => {
  await client.shutdown();
  process.exit(0);
});
```

This is recommended but not required. If the process exits without calling `shutdown()`, any events still in the in-memory batch queue will be lost.

## Known Limitations

- **In-memory queue only**: Events are held in memory until flushed. If the host process crashes or is killed before flushing, those events are lost. This is standard for a v0.1.0 SDK. For durability-critical use cases, persist events to disk or a message queue before passing them to the SDK.

- **No persistent local queue**: There is no disk-backed or WAL-based queue. "Never lose events" applies only to transient network/5xx/429 failures during the process's lifetime, not process-level failures.

- **Single-process only**: The batcher state is in-process memory. Do not share a `QuantiqenClient` instance across worker threads or child processes.

- **500 event cap per request**: The backend rejects batches larger than 500. The SDK enforces this automatically by chunking.

## Event Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `eventType` | string (1-500) | Yes | Event type (e.g. `auth.login`) |
| `eventCategory` | string (1-100) | Yes | Category (e.g. `authentication`) |
| `severity` | enum | Yes | `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `INFO` |
| `source` | string (1-200) | Yes | Source system (e.g. `aws-cloudtrail`) |
| `occurredAt` | ISO 8601 | Yes | When the event occurred |
| `payload` | JSON object | Yes | Event data |
| `eventVersion` | string | No | Schema version (default `1.0`) |
| `assetId` | UUID | No | Associated asset |
| `idempotencyKey` | string | No | Dedup key (derived server-side if absent) |
| `metadata` | JSON object | No | Additional metadata (allow-listed fields) |

## Telemetry Ingestion

Typed helpers for metrics, traces/spans, performance and logs. They build the
same wire events as `sendEvent` (the platform's event DTO is the contract —
no platform changes), queue them through the same batcher, and are
fire-and-forget like everything else:

- `eventCategory` is always `"telemetry"`; `eventType` is
  `telemetry.{metric|span|performance|log}`.
- `payload` carries `telemetryType` plus exactly one of `metric` / `span` /
  `performance` / `log`.
- A random UUID `idempotencyKey` is generated per record (override via
  `common.idempotencyKey`) so same-name/same-second metrics never falsely
  dedup.
- Severity defaults to `INFO`; `sendLog` maps level → severity
  (`warn`→`MEDIUM`, `error`→`HIGH`, `fatal`→`CRITICAL`) unless you set one.
- Builders validate strictly and throw; the client's `send*` methods catch
  and log instead (a malformed record never crashes your app).
- Trace IDs, labels and attributes live in `payload`, not `metadata`
  (metadata is an allow-listed set server-side).

```ts
// Metric (counter | gauge | histogram | distribution)
await client.sendMetric(
  { name: 'http.requests', kind: 'counter', value: 1, labels: { route: '/users' } },
  { source: 'api' },
);

// Span / trace (W3C-style hex ids)
await client.sendSpan(
  {
    traceId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    spanId: '0123456789abcdef',
    name: 'GET /users',
    kind: 'server',
    startTime: '2026-01-01T00:00:00.000Z',
    durationMs: 120,
    status: 'ok',
  },
  { source: 'api' },
);

// Performance
await client.sendPerformance(
  { operation: 'POST /checkout', durationMs: 842.5, status: 'ok', errorRate: 0.01 },
  { source: 'checkout' },
);

// Log (severity auto-mapped from level)
await client.sendLog(
  { level: 'error', message: 'checkout failed', attributes: { orderId: 'o-1' } },
  { source: 'checkout' },
);

await client.flush();
```

Payload shapes:

| Kind | `payload.<kind>` fields |
|------|-------------------------|
| `metric` | `name`, `kind`, `value?` (counter/gauge), `values?` (histogram/distribution), `unit?`, `labels?` |
| `span` | `traceId`, `spanId`, `parentSpanId?`, `name`, `kind`, `startTime`, `endTime?`, `durationMs?`, `status?` (`ok`/`error`/`unset`), `attributes?`, `events?` |
| `performance` | `operation`, `durationMs`, `status?`, `throughputPerSec?`, `errorRate?` (0–1), `resource?`, `dimensions?` |
| `log` | `level` (`debug`/`info`/`warn`/`error`/`fatal`), `message`, `attributes?` |

For plain (non-typed) telemetry, use `sendEvent` directly — the convention is
optional, not enforced by the platform.

## License

MIT
