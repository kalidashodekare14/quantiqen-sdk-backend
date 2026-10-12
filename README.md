# QUANTIQEN SDK Backend

Public ingestion edge for the QUANTIQEN SDKs. A thin Express + TypeScript proxy that
adds guardrails (request-id, CORS allow-list, API-key format pre-check, per-IP rate
limit, body limit, timeouts, error envelope) and forwards telemetry to the private
NestJS platform.

```
SDK ──HTTPS + X-API-KEY──▶ SDK Backend (this service, public)
                                 │  format check, request-id, edge rate limit,
                                 │  body limit, timeout, error envelope
                                 ▼
                          NestJS /api/v1/events[/bulk] (private)
                                 │  ApiKeyGuard (source of truth), scopes,
                                 │  rate limits, idempotency → BullMQ pipeline
```

**This edge never authenticates, parses, scores, or decides.** Real API-key validation,
DTO validation, and the detection pipeline stay on the platform. See `docs/sdk_plan.md`
§4–§5 for the full design.

## Repository layout

| Path | What it is |
|---|---|
| `src/`, `test/` | Express SDK edge (this service) — pure proxy in front of the platform |
| `sdk-nodejs/` | `@quantiqen/sdk` — Node.js telemetry SDK ([README](./sdk-nodejs/README.md)) |
| `sdk-python/` | `quantiqen-sdk` — Python telemetry SDK ([README](./sdk-python/README.md)) |
| `docs/sdk_plan.md` | Full public-SDKs plan (phases, repo strategy, release workflow) |

The SDKs are maintained here and publish from this repository. They talk to the
edge above; the edge forwards to the private platform.

## Endpoints

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `GET` | `/health` | none | Liveness — `200 { status: 'ok', uptime_s }` |
| `GET` | `/ready` | none | `200` if the platform `/api/v1/health` is reachable (2s timeout), else `503` |
| `POST` | `/v1/events` | `X-API-KEY` (format only) | Proxy → `{NESTJS_BASE_URL}/api/v1/events` |
| `POST` | `/v1/events/bulk` | `X-API-KEY` (format only) | Proxy → `{NESTJS_BASE_URL}/api/v1/events/bulk` |

Requests must send a key matching `qtn_{live|test|dev}_<secret>`; anything else is
rejected with `400 INVALID_API_KEY` before touching the platform. The platform's
`ApiKeyGuard` remains the only source of truth.

## Quick start

```bash
cp .env.example .env          # set NESTJS_BASE_URL to the platform URL
npm install
npm run dev                   # tsx watch on :3000
```

```bash
curl -s http://localhost:3000/health
# {"status":"ok","uptime_s":12}

curl -s http://localhost:3000/v1/events/bulk \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: qtn_test_..." \
  -d '{"events":[{"type":"auth.login","metadata":{}}]}'
```

## Environment

| Var | Required | Default | Notes |
|---|---|---|---|
| `PORT` | ✅ | `3000` | Render injects this automatically |
| `NESTJS_BASE_URL` | ✅ | — | Private platform base URL, e.g. `https://<platform>.onrender.com` |
| `REQUEST_TIMEOUT_MS` | ❌ | `10000` | Upstream timeout → `504 UPSTREAM_TIMEOUT` |
| `MAX_BODY_SIZE` | ❌ | `512kb` | Oversized → `413 PAYLOAD_TOO_LARGE` (500-event bulk ≈ 250–500 KB) |
| `CORS_ORIGINS` | ❌ | — | Comma list; omit → no CORS headers (SDKs are server-side) |
| `INTERNAL_PROXY_SECRET` | ❌ | — | Sent upstream as `X-Internal-Proxy-Secret`; inbound values are stripped |
| `RATE_LIMIT_WINDOW_MS` | ❌ | `60000` | Edge per-IP window |
| `RATE_LIMIT_MAX` | ❌ | `600` | Per-IP requests/window (platform per-key limits are authoritative) |
| `LOG_LEVEL` | ❌ | `info` | `debug` \| `info` \| `warn` \| `error` |

Secrets are env-only and never logged; API keys are redacted to `qtn_[redacted]`.

## Error envelope

Edge errors use the platform standard envelope; platform responses pass through untouched.

```json
{ "error": { "code": "UPSTREAM_TIMEOUT", "message": "...", "request_id": "..." } }
```

| Case | Status | Code |
|---|---|---|
| Missing/bad `X-API-KEY` format | 400 | `INVALID_API_KEY` |
| Edge per-IP rate limit exceeded | 429 | `RATE_LIMITED` (+ `Retry-After`) |
| Body > `MAX_BODY_SIZE` | 413 | `PAYLOAD_TOO_LARGE` |
| Malformed JSON | 400 | `BAD_REQUEST` |
| Upstream timeout | 504 | `UPSTREAM_TIMEOUT` |
| Upstream unreachable | 503 | `UPSTREAM_UNAVAILABLE` |
| Everything from NestJS | passthrough | passthrough (401/422/429/…) |

## Telemetry payloads (convention, docs-only)

The edge is a pure proxy — telemetry is **not** interpreted here (§4.4 of the
plan: no business logic at the edge). The convention lives in the SDKs and is
enforced by the platform's event DTO (free-form JSON `payload`):

- `eventCategory: "telemetry"`, `eventType: "telemetry.{metric|span|performance|log}"`
- `payload.telemetryType` discriminates `metric` / `span` / `performance` / `log`
- Auto-generated UUID `idempotencyKey` per record (metrics dedup collision-proof)
- Severity defaults `INFO`; log level→severity maps within the existing enum

```
SDK sendMetric/sendSpan/sendPerformance/sendLog
  → batcher (existing /v1/events/bulk path)
    → this edge (format check, rate limit, proxy only)
      → {NESTJS_BASE_URL}/api/v1/events/bulk (validation, enrichment, redaction)
```

Curl through the edge (same as any event — no special telemetry route):

```bash
curl -X POST https://api.quantiqen.com/v1/events/bulk \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: qtn_live_..." \
  -d '{"events":[{"eventType":"telemetry.metric","eventCategory":"telemetry","severity":"INFO","source":"api","occurredAt":"2026-01-01T00:00:00Z","idempotencyKey":"11111111-2222-3333-4444-555555555555","payload":{"telemetryType":"metric","metric":{"name":"http.requests","kind":"counter","value":1,"labels":{"route":"/users"}}}}]}'
```

## Development

```bash
npm run lint        # oxlint
npm run typecheck   # tsc --noEmit
npm test            # vitest (upstream mocked via global fetch)
npm run test:cov    # vitest + coverage (≥80% thresholds)
npm run build       # tsc → dist/
npm start           # node dist/server.js
```

SDKs (each folder is self-contained):

```bash
cd sdk-nodejs && npm install && npm test && npm run build   # Node SDK
cd sdk-python && pip install pytest && PYTHONPATH=src python -m pytest
```

## Deploy (Render)

- Build: `npm ci && npm run build` — Start: `node dist/server.js` — Health check: `/health`
- Set `NESTJS_BASE_URL` (and optionally `INTERNAL_PROXY_SECRET`, `CORS_ORIGINS`) in the
  Render dashboard — never commit them
- Attach the custom domain `api.quantiqen.com`; SDKs default to that base URL

## License

MIT — see [LICENSE](./LICENSE).
