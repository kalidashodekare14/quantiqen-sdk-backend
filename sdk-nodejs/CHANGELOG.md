# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-12

### Added

- Initial release: `QuantiqenClient` with in-memory batching (default 100 events,
  500-event chunk cap), automatic retry with exponential backoff and jitter on
  network errors / 5xx / 429, `Retry-After` handling, and
  `X-RateLimit-Remaining`-aware throttling.
- `POST /v1/events/bulk` ingestion against the QUANTIQEN SDK edge
  (`https://api.quantiqen.com` by default).
- Automatic event metadata enrichment (`sdkLanguage`, `sdkVersion`, `userAgent`).
- Fire-and-forget semantics: `sendEvent()`/`sendEvents()` never throw; failures
  are logged via the configurable `logger`.
- Telemetry ingestion helpers: `sendMetric()` / `sendSpan()` / `sendPerformance()` /
  `sendLog()` plus strict builders (`buildMetricEvent`, `buildSpanEvent`,
  `buildPerformanceEvent`, `buildLogEvent`) and typed models. Records ride the
  existing event envelope (`eventCategory: "telemetry"`,
  `telemetry.{metric|span|performance|log}`) with a discriminated
  `payload.telemetryType`; auto-UUID `idempotencyKey` per record; `sendLog`
  maps log level to severity.

### Fixed

- Requests now carry a 30s timeout (`AbortSignal`), matching the Python SDK.
- Retries exhausted on HTTP 5xx now surface an `HTTP <status>` error instead of
  possibly throwing `undefined`.
- Non-retryable HTTP 4xx failures are logged instead of dropped silently.
- A `Retry-After` pause is no longer re-applied after it has elapsed.

[0.1.0]: https://github.com/kalidashodekare14/quantiqen-sdk-backend/releases/tag/sdk-nodejs-v0.1.0
