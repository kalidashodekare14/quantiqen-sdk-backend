# QUANTIQEN SDK Plan — Public SDKs + Express SDK Backend

> Phase-by-phase execution plan for publishing the Node.js and Python SDKs and introducing
> the new Express.js + TypeScript **SDK Backend** (public ingestion edge that proxies into
> the NestJS platform). Status: **APPROVED**. Owner: platform team.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Scorecard](#2-current-state-scorecard)
3. [Decisions Required](#3-decisions-required)
4. [Target Architecture](#4-target-architecture)
5. [Express SDK Backend — Full Design](#5-express-sdk-backend--full-design)
6. [SDK Code Updates](#6-sdk-code-updates)
7. [Public Repository Strategy](#7-public-repository-strategy)
8. [Phase-by-Phase Roadmap](#8-phase-by-phase-roadmap)
9. [CI Design](#9-ci-design)
10. [Release Workflow (step-by-step)](#10-release-workflow-step-by-step)
11. [Launch Verification](#11-launch-verification)
12. [Post-Launch Maintenance](#12-post-launch-maintenance)
13. [Secrets & Commands Appendix](#13-secrets--commands-appendix)
14. [Convention Compliance Notes](#14-convention-compliance-notes)

---

## 1. Executive Summary

The two SDKs (`sdks/sdk-nodejs`, `sdks/sdk-python`) are **engineering-ready (~70%)**:
batching, retry, throttling, 43 + 41 passing tests, CI jobs green, and a complete
release workflow that genuinely publishes to npm and PyPI on version tags.

They are **release-blocked** on:

- 6 external items (license contradiction, npm org, PyPI name, registry secrets, repo visibility, domain)
- ~10 code bugs/parity gaps (detailed in §6)
- The new **Express SDK Backend**, which becomes the public edge the SDKs talk to

**Target outcome:** customers `npm install @quantiqen/sdk` / `pip install quantiqen-sdk`,
point the SDK at `https://api.quantiqen.com`, and telemetry flows:

```
SDK ──HTTPS + X-API-KEY──▶ Express SDK Backend (public edge)
                                 │  format check, request-id, edge rate limit,
                                 │  body limit, timeout, error envelope
                                 ▼
                          NestJS /api/v1/events[/bulk] (private)
                                 │  ApiKeyGuard (source of truth), scopes,
                                 │  rate limits, idempotency → BullMQ pipeline
```

**ETA:** public within 1 working day of the Phase 0 account/decision items.

---

## 2. Current State Scorecard

### Node SDK — `@quantiqen/sdk` (70/100)

| Dimension | Status |
|---|---|
| Structure (src/tests/docs) | ✅ `src/{index,client,batcher,retry,types}.ts`, `tests/*.test.ts` |
| Functionality | ⚠️ Works; bugs: no fetch timeout, `throw lastError` can be `undefined`, silent 4xx drop |
| Auth | ✅ `X-API-KEY` header, `qtn_` format validation (`src/client.ts:30-34,126`) |
| Endpoints called | ✅ `POST {base}/v1/events/bulk` only (`src/client.ts:110`), 500-event chunks |
| Tests | ✅ 43 tests (client 12, batcher 11, retry 20), vitest, passing |
| CI | ✅ `.github/workflows/ci.yml:126-158` (Node 24, build + test + junit) |
| README | ✅ Good; 3 factual inaccuracies (single-event claim, default domain, ESM-only undocumented) |
| Metadata | ⚠️ Broken URLs (private repo 404), homepage points at `development`, ESM-only exports |
| Legal | 🔴 No LICENSE file; root says proprietary, SDK says MIT |
| Registry | 🔴 npm org `@quantiqen` does not exist |

### Python SDK — `quantiqen-sdk` (65/100)

| Dimension | Status |
|---|---|
| Structure | ✅ `src/quantiqen_sdk/{__init__,client,batcher,retry,types}.py`, hatchling build |
| Functionality | ⚠️ Works; stdlib-only (`urllib`); bugs: `flush()` drains one batch only, stale 429 retry-after |
| Auth | ✅ `X-API-KEY`, `qtn_` validation (`client.py:31-34,111`) |
| Endpoints called | ✅ `POST {base}/v1/events/bulk` (`client.py:100`) |
| Tests | ✅ 41 tests, pytest, passing |
| CI | ✅ `ci.yml:160-192` (Python 3.12, editable install + pytest) |
| README | ✅ Good; same 3 inaccuracies |
| Packaging | ⚠️ No `py.typed`, no `__version__`, no sdist config |
| Legal / Registry | 🔴 Same as Node; PyPI `quantiqen-sdk` unclaimed |

### Release automation — `release-sdks.yml` (COMPLETE, never run)

- Triggers: tags `sdk-nodejs-v*` → `npm publish`; `sdk-python-v*` → `pypa/gh-action-pypi-publish`
- Verifies tag == manifest version (skipped on `workflow_dispatch` — hardening needed)
- Requires repo secrets `NPM_TOKEN`, `PYPI_API_TOKEN` — **not yet set**
- Zero tags exist; zero publishes have occurred

### Path mismatch — RESOLVED by design

The audit flagged: SDKs call `{base}/v1/events/bulk` but NestJS serves `/api/v1/events/bulk`.
With the Express SDK Backend exposing **`/v1/events`** at the edge and proxying to NestJS
`/api/v1/*`, the **SDK paths stay exactly as they are — no SDK path change, no test change.**

---

## 3. Decisions Required

| # | Decision | Recommendation | Owner |
|---|---|---|---|
| D1 | License | **MIT for SDKs and SDK backend only**; root backend stays proprietary/`UNLICENSED`. Add `LICENSE` files + SPDX headers. Fix root `README.md` license note to say "SDKs are MIT, backend is proprietary". | User |
| D2 | Public repo | **Separate public repo** for SDKs (+ optional SDK backend). Backend repo stays private. | User (manual placement) |
| D3 | Domain | Keep default `https://api.quantiqen.com` — **register `quantiqen.com` before launch**. | User |
| D4 | npm | Create npm org/user **`quantiqen`** (currently 404). `@quantiqen/sdk` is available but unclaimed. | User |
| D5 | PyPI | Claim **`quantiqen-sdk`** (currently 404). | User |
| D6 | Secrets | Set `NPM_TOKEN` (automation token) + `PYPI_API_TOKEN` on the public SDK repo. | User |

Everything else in this plan is implementation work owned by engineering.

---

## 4. Target Architecture

### 4.1 Components

| Component | Stack | Visibility | Role |
|---|---|---|---|
| **SDK Backend** (`sdk-backend/`) | Express.js + TypeScript | Public (`api.quantiqen.com`) | Thin ingestion edge: guardrails + proxy |
| **Platform Backend** (`src/` — existing) | NestJS + Prisma | Private | Source of truth: API keys, scopes, rate limits, idempotency, queues, detection pipeline |
| **Node SDK** | TypeScript (ESM) | npm `@quantiqen/sdk` | Fire-and-forget telemetry client |
| **Python SDK** | Python 3.9+ | PyPI `quantiqen-sdk` | Fire-and-forget telemetry client |

### 4.2 Request lifecycle (bulk example)

1. SDK batches events in memory; at `flushIntervalMs` or `batchSize` it POSTs up to 500 events
   to `POST https://api.quantiqen.com/v1/events/bulk` with header `X-API-KEY: qtn_live_...`
2. Express edge middleware chain (order is significant):
   `request-id → cors → api-key-format → rate-limit (per-IP) → body-limit → routes/events → proxy/nest-client`
3. `nest-client` forwards the **raw body** and `X-API-KEY` header to
   `{NESTJS_BASE_URL}/api/v1/events/bulk` with `REQUEST_TIMEOUT_MS` (default 10s) and optional
   `X-Internal-Proxy-Secret`
4. NestJS `ApiKeyGuard` validates the key (hash + Redis cache), `RateLimitGuard` applies
   per-key limits, `EventsService.ingestBulk` upserts idempotently and enqueues to the
   `ingestion` BullMQ queue
5. NestJS response (201 + results/acceptedCount/…, or 401/422/429 error envelope) is
   streamed back **untouched** by Express
6. SDK handles 429 by honoring `Retry-After`; retries with exponential backoff; failures logged

### 4.3 Auth model

- **Customer credential = `X-API-KEY`** (`qtn_{live|test|dev}_{secret}`) — validated ONLY by
  NestJS `ApiKeyGuard`. Express never stores, hashes, or caches keys.
- Express does a cheap **format pre-check** (`qtn_` prefix) to reject obvious garbage with a
  400 before touching NestJS. This is cosmetic defense-in-depth, not auth.
- Optional **service-to-service secret**: `X-Internal-Proxy-Secret` header set by Express and
  verified by NestJS (future middleware) so the platform can distinguish edge vs. direct
  traffic. Ships as env-optional; not required for MVP.

### 4.4 What Express deliberately does NOT do

Per platform rules (AI must explain never score; no business logic in the edge; detection
pipeline is deterministic and queued):

- ❌ No API-key issuance/storage/validation logic
- ❌ No event parsing/normalization beyond JSON parse (NestJS DTO validation is authoritative)
- ❌ No scoring, detection, risk, or decision logic
- ❌ No DB, no Redis, no queues in MVP (edge rate limiter is in-memory; see §5.6 scaling note)
- ❌ No websockets/SSE (realtime stays on NestJS `GET /api/v1/events` SSE)

---

## 5. Express SDK Backend — Full Design

### 5.1 Location (TBD by user — manual decision)

This plan keeps the service **location-agnostic**. Two supported placements:

| Option | Layout | Pros |
|---|---|---|
| **A. Public SDK repo** (recommended) | `sdk-backend/` beside `sdk-nodejs/`, `sdk-python/` in the public repo | Single public surface; SDK + edge version together |
| **B. Private repo** | New private repo; Render deploys from it | Edge code stays private; only SDKs are public |

The internal structure below is identical either way. Folder name: **`sdk-backend/`**.

### 5.2 File structure (feature-based, mirrors backend conventions)

```
sdk-backend/
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── LICENSE
├── src/
│   ├── server.ts                 # bootstrap: load env → validate → start listen
│   ├── app.ts                    # express app wiring (middleware + routes)
│   ├── config.ts                 # zod env schema (same pattern as platform configuration.ts)
│   ├── logger.ts                 # structured JSON logs with request_id + correlation_id
│   ├── middleware/
│   │   ├── request-id.ts         # req.id = req.header('X-Request-Id') ?? crypto.randomUUID()
│   │   ├── cors.ts               # CORS_ORIGINS allow-list (never *)
│   │   ├── api-key-format.ts     # 400 INVALID_API_KEY if !/^qtn_(live|test|dev)_/
│   │   ├── rate-limit.ts         # per-IP sliding window (in-memory, MVP)
│   │   ├── body-limit.ts         # express.json({ limit: MAX_BODY_SIZE }) — default 512kb
│   │   └── error-handler.ts      # maps thrown errors → { error: { code, message, request_id } }
│   ├── routes/
│   │   ├── health.ts             # GET /health, GET /ready
│   │   └── events.ts             # POST /v1/events, POST /v1/events/bulk
│   └── proxy/
│       └── nest-client.ts        # timeout-ed fetch forwarder, header policy, status passthrough
└── test/
    ├── events.test.ts            # supertest: proxy behavior
    ├── health.test.ts
    └── middleware.test.ts        # format check, rate limit, body limit, error envelope
```

`package.json` conventions: `"type": "module"`, `engines.node >= 18`, deps: `express@^5`,
`zod`, `cors`; devDeps: `typescript`, `vitest`, `supertest`, `@types/{express,cors,supertest,node}`.
Scripts: `build` (tsc), `start` (node dist/server.js), `dev` (tsx watch), `test` (vitest run),
`lint` (oxlint), `typecheck` (tsc --noEmit). Root `tsconfig` mirrors the platform:
`module: nodenext`, `strict: true`, `target: ES2023`, ESM imports with `.js` extensions.

### 5.3 Endpoints

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `GET` | `/health` | none | `200 { status: 'ok', uptime_s }` — liveness |
| `GET` | `/ready` | none | `200` if `NESTJS_BASE_URL` reachable (HEAD/GET `/health` w/ 2s timeout), else `503` |
| `POST` | `/v1/events` | `X-API-KEY` (format) | Proxy → `{NESTJS_BASE_URL}/api/v1/events` |
| `POST` | `/v1/events/bulk` | `X-API-KEY` (format) | Proxy → `{NESTJS_BASE_URL}/api/v1/events/bulk` |

No other routes in MVP. Swagger is NOT re-exposed at the edge (platform Swagger stays private).

### 5.4 Proxy semantics (`proxy/nest-client.ts`)

- **Forward:** method, path mapping (`/v1/*` → `/api/v1/*`), JSON body, headers
  `X-API-KEY`, `X-Request-Id`, optional `X-Internal-Proxy-Secret`, `X-SDK-Version` (passthrough)
- **Strip:** all other inbound headers (no header forwarding tricks, no SSRF surface —
  upstream URL is fixed config, never customer-supplied)
- **Timeout:** `AbortSignal.timeout(REQUEST_TIMEOUT_MS)` → map to
  `504 UPSTREAM_TIMEOUT` in our envelope
- **Upstream connection failure:** `503 UPSTREAM_UNAVAILABLE`
- **Status passthrough:** any NestJS response (2xx/4xx/5xx) forwarded with body untouched,
  plus response header `X-Request-Id`
- **Never retry upstream POSTs** (idempotency keys already exist server-side; retrying is the
  SDK's job — the SDKs already implement backoff)

### 5.5 Error envelope

Identical to the platform standard (`{ "error": { "code", "message", "request_id" } }`):

| Case | Status | Code |
|---|---|---|
| Missing/bad `X-API-KEY` format | 400 | `INVALID_API_KEY` |
| Edge per-IP rate limit exceeded | 429 | `RATE_LIMITED` (with `Retry-After`) |
| Body > `MAX_BODY_SIZE` | 413 | `PAYLOAD_TOO_LARGE` |
| Malformed JSON | 400 | `BAD_REQUEST` |
| Upstream timeout | 504 | `UPSTREAM_TIMEOUT` |
| Upstream unreachable | 503 | `UPSTREAM_UNAVAILABLE` |
| Everything from NestJS | passthrough | passthrough (401/422/429/…) |

### 5.6 Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `PORT` | ✅ | `3000` | Render injects automatically |
| `NESTJS_BASE_URL` | ✅ | — | e.g. `https://<platform>.onrender.com` (private service URL) |
| `REQUEST_TIMEOUT_MS` | ❌ | `10000` | Upstream timeout |
| `MAX_BODY_SIZE` | ❌ | `512kb` | Bulk of 500 events ≈ 250–500 KB |
| `CORS_ORIGINS` | ❌ | — | Comma list; omit → no CORS headers (SDKs are server-side) |
| `INTERNAL_PROXY_SECRET` | ❌ | — | Sent as `X-Internal-Proxy-Secret` when set |
| `RATE_LIMIT_WINDOW_MS` | ❌ | `60000` | Edge per-IP window |
| `RATE_LIMIT_MAX` | ❌ | `600` | Per-IP requests/window (generous; platform per-key limits are authoritative) |
| `LOG_LEVEL` | ❌ | `info` | |

`.env.example` documents all of the above with comments. Secrets never logged; API keys
redacted in logs (log only the `qtn_` prefix + key id if present, never the full key).

### 5.7 Deployment (Render)

- Render Web Service, build `npm ci && npm run build`, start `node dist/server.js`
- Health check path: `/health`
- Auto-deploy on push to the branch hosting the service (per repo choice in §5.1)
- Domain: `api.quantiqen.com` → Render (requires D3 domain registration)
- The platform service URL (`NESTJS_BASE_URL`) is set as a Render env var — never committed

### 5.8 Scaling note (deferred, per platform scaling triggers)

In-memory per-IP limiter is correct for MVP. If edge instances scale >1 and limits must be
exact, move the limiter to Redis (platform already runs Redis). This is a contained change
inside `middleware/rate-limit.ts` — no other code touches it. Do NOT add Kafka/ClickHouse/etc.

---

## 6. SDK Code Updates

### 6.1 Both SDKs — correctness (Phase 1)

| # | Fix | File(s) |
|---|---|---|
| S1 | Default `baseUrl` stays `https://api.quantiqen.com` — now VALID because the Express edge serves `/v1`. **No path changes.** Update README config tables to state the edge explicitly. | `client.ts:37`, `types.py:67`, READMEs |
| S2 | README line 5 claims `POST /v1/events` is wrapped — SDKs only call `/bulk`. Fix the claim (recommended) or add an optional `sendEvent()` single-event helper later. | `sdk-nodejs/README.md:5`, `sdk-python/README.md:5` |
| S3 | Node: add `AbortSignal.timeout(30_000)` to `fetch` (parity with Python `timeout=30`). | `client.ts:122-129` |
| S4 | Node: `throw lastError` can throw `undefined` when all attempts were HTTP 5xx — throw `new Error(\`HTTP ${status}\`)`. | `client.ts:118,159` |
| S5 | Node: log non-retryable HTTP failures (4xx) instead of silently dropping — README already promises "failures are logged". | `client.ts:139-141` |
| S6 | Python: `flush()` drains only one batch; drain the whole queue (while-loop, parity with Node). | `batcher.py:61-62` |
| S7 | Both: reset `retryAfterMs` / `_rate_limit_retry_after_ms` after the pause elapses (stale delay currently re-applied on every later flush). | `batcher.ts:107-118`, `batcher.py:116-124` |
| S8 | Node: document ESM-only in README ("Node ≥18, ESM; CommonJS needs dynamic import"). | README + `package.json` |

### 6.2 Packaging (Phase 2)

| # | Change | File(s) |
|---|---|---|
| P1 | Add `LICENSE` (full MIT text) to each SDK + root `LICENSE` for SDK scope note | new files |
| P2 | SPDX headers `// SPDX-License-Identifier: MIT` / `# SPDX-License-Identifier: MIT` on all 13 source files | all `src/` |
| P3 | Python: add `src/quantiqen_sdk/py.typed` + ensure it ships in the wheel | new file + pyproject |
| P4 | Python: add `__version__ = "0.1.0"` to `__init__.py`; Node: keep `SDK_VERSION` but add a release-workflow check that it equals the manifest | `__init__.py`, `client.ts:10`, `client.py:18` |
| P5 | Node: `exports` → put `types` first; add `./package.json` subpath | `package.json:8-13` |
| P6 | Node: drop `dist/*.js.map` from the tarball OR ship `src/` too (current maps point at missing sources) | `package.json` `files` |
| P7 | Fix `repository`/`homepage`/`bugs` URLs → new public repo, branch `main` | `package.json:35-43`, `pyproject.toml:29-32` |
| P8 | Add `CHANGELOG.md` per SDK (Keep-a-Changelog format), seeded with `0.1.0` | new files |
| P9 | Author metadata: add email/URL | manifests |

### 6.3 Test/CI gaps (Phase 5)

- Node: run `tsc --noEmit` over `tests/` (currently excluded from typecheck)
- Add oxlint/prettier scope for `sdk-backend/` and SDK sources
- Python: add `mypy` (strict) using `py.typed`; add 3.9 + 3.13 CI matrix legs to back classifiers
- Both: add coverage reporting (vitest coverage / pytest-cov) with a modest threshold (≥80%)

---

## 7. Public Repository Strategy

**Chosen approach: separate public repository.** The platform backend repo stays private.
The user will create and place the public repo **manually** (Option A or B in §5.1).

### 7.1 Steps (run by engineering once the repo exists)

```bash
# 1. From the private repo, extract SDK history (path-preserving split)
git subtree split --prefix=sdks -b sdk-public-split

# 2. Clone the new empty public repo and bring the split history in
git clone git@github.com:<org>/<public-repo>.git
cd <public-repo>
git pull ../quantiqen-backend sdk-public-split:main

# 3. Re-root to the public layout (SDKs at repo root, not under sdks/)
git mv sdks/sdk-nodejs sdk-nodejs
git mv sdks/sdk-python sdk-python
# if Option A also moves the edge:
# git subtree split --prefix=sdk-backend -b sdk-backend-split   (from private repo)
# git merge sdk-backend-split → mv to ./sdk-backend
git commit -m "chore: re-root SDKs for public repository"

# 4. Add root files: LICENSE (MIT), README.md (SDK overview), CHANGELOG.md
# 5. Fix every repository/homepage/bugs URL in both manifests to THIS repo, branch main
# 6. Push main; verify CI green on the public repo
```

### 7.2 Repo contents policy

| Public | Never public |
|---|---|---|
| `sdk-nodejs/`, `sdk-python/`, (`sdk-backend/` if Option A) | Any NestJS platform source |
| `LICENSE`, `README.md`, `CHANGELOG.md`, `.github/workflows/*` | `.env` files, real API keys, DB URLs |
| Test suites with mocked HTTP only | Internal Render/AI-Engine URLs (`onrender.com`) |

### 7.3 URL/links to fix before publish

- `package.json` `repository`/`homepage`/`bugs` → public repo (`main` branch, not `development`)
- `pyproject.toml` `[project.urls]` → same
- Both READMEs' install/quickstart sections
- Root (private) README SDK section: link to the public repo

---

## 8. Phase-by-Phase Roadmap

### Phase 0 — Decisions & accounts (user, ~1–2 h wall-clock)

- [ ] D1: confirm MIT-for-SDKs licensing decision
- [ ] D3: register `quantiqen.com` (or confirm final default domain)
- [ ] D4: create npm org `quantiqen` → generate **Automation token** → `NPM_TOKEN`
- [ ] D5: create PyPI account + claim `quantiqen-sdk` → API token → `PYPI_API_TOKEN`
- [ ] D2: create the public GitHub repo (empty) and share the URL with engineering
- [ ] D6: add `NPM_TOKEN` + `PYPI_API_TOKEN` as Actions secrets on the **public** repo

### Phase 1 — SDK correctness fixes (~half day, engineering)

1. Apply S1–S8 (§6.1); update READMEs
2. Run both suites: `npm test` in `sdk-nodejs/`; `pytest` in `sdk-python/`
3. Commit to the branch that will be split into the public repo

### Phase 2 — Packaging hardening (~2 h)

1. Apply P1–P9 (§6.2)
2. Verify tarballs: `npm pack --dry-run` (Node) and `python -m build` + `twine check dist/*` (Python)
3. Confirm `py.typed` inside the wheel and LICENSE inside both tarballs

### Phase 3 — Express SDK Backend (~1 day)

1. Scaffold `sdk-backend/` per §5.2 (tsconfig mirrors platform: ESM, nodenext, strict)
2. Implement `config.ts` zod schema (§5.6) — fail fast on boot, same pattern as platform
3. Implement middleware chain in the order of §4.2; error handler produces the envelope
4. Implement `routes/health.ts` and `routes/events.ts` (path map `/v1/*` → `/api/v1/*`)
5. Implement `proxy/nest-client.ts` (timeout, header policy, status passthrough)
6. Tests (supertest, upstream mocked):
   - bulk proxy happy path → asserts method/path/header forwarding + 201 passthrough
   - missing key → 400 `INVALID_API_KEY` (never hits upstream — assert mock not called)
   - malformed JSON → 400; oversized body → 413
   - upstream 422/429 envelope passthrough (assert body untouched)
   - upstream timeout → 504 `UPSTREAM_TIMEOUT`
   - `/health` + `/ready` behavior
7. `.env.example` + README (env table, curl example, architecture diagram)
8. Lint + typecheck + tests green

### Phase 4 — Public repo extraction (§7 steps, ~1 h)

1. Execute §7.1 steps 1–6
2. Smoke-check: fresh clone → `npm ci && npm test` (Node), `pip install -e . && pytest` (Python)

### Phase 5 — CI on the public repo (~2 h)

1. Port the two SDK jobs from private `ci.yml` (§9)
2. Add the `sdk-backend` job
3. Add lint/typecheck/matrix/coverage upgrades (§6.3)
4. Verify all jobs green on a PR inside the public repo

### Phase 6 — Release workflow (§10, ~2 h)

1. Port + harden `release-sdks.yml` onto the public repo (§10.2)
2. Add backend deploy path (Render auto-deploy or `workflow_dispatch` render deploy — §10.3)
3. Dry-run both publish paths

### Phase 7 — Launch (§11, ~1 h)

1. Deploy SDK backend to Render; attach `api.quantiqen.com`
2. Tag + publish `0.1.0` of both SDKs
3. Registry smoke tests; enable monitoring

---

## 9. CI Design

### Public repo `.github/workflows/ci.yml`

Triggers: push + PR to `main`. Three jobs:

**`sdk-nodejs`** (ported from private `ci.yml:126-158` + upgrades)
- Node matrix: `[18, 20, 24]`
- `npm ci` → `npm run lint` → `tsc --noEmit` (src **and** tests) → `npm test -- --coverage`
- junit + coverage artifacts

**`sdk-python`** (ported from `ci.yml:160-192` + upgrades)
- Python matrix: `[3.9, 3.11, 3.13]`
- `pip install -e . pytest pytest-cov mypy ruff` → `ruff check` → `mypy quantiqen_sdk` →
  `pytest --cov` → junit + coverage artifacts

**`sdk-backend`** (new)
- Node 24
- `npm ci` → `npm run lint` → `npm run typecheck` → `npm test -- --coverage`
- No live services needed (upstream mocked in tests)

Private repo `ci.yml` keeps its existing SDK jobs until Phase 4 lands, then they are removed
to avoid duplicate maintenance.

---

## 10. Release Workflow (step-by-step)

### 10.1 Versioning policy

- SemVer per package, independent versions allowed
- Git tag format: `sdk-nodejs-v<semver>`, `sdk-python-v<semver>` (matches existing
  `release-sdks.yml` contract)
- Manifest version, `SDK_VERSION` constants, and tag must match — enforced in the workflow
- CHANGELOG entry required before tagging

### 10.2 SDK publish workflow (public repo — ported + hardened `release-sdks.yml`)

Steps executed by the workflow on tag push:

1. Checkout at the tag
2. **Version guard** (runs on `workflow_dispatch` too — fix the current bypass): tag suffix
   == `package.json.version` == `SDK_VERSION` constant (Node); == `pyproject.toml` version ==
   `client.py` `SDK_VERSION` (Python)
3. `npm ci && npm test && npm run build`
4. `npm publish --access public --provenance` with `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`
   (add `permissions: id-token: write` for provenance)
5. Python leg: `pip install build twine` → verify → `python -m build` → `twine check dist/*`
   → publish via `pypa/gh-action-pypi-publish` (prefer **Trusted Publishing** with
   `id-token: write`; fall back to `PYPI_API_TOKEN`)
6. Create a GitHub Release with CHANGELOG section attached

Hardening (apply now, not later):
- Add `environment: npm-publish` / `environment: pypi-publish` with required reviewers
- Pin `pypa/gh-action-pypi-publish` and `actions/*` to full commit SHAs
- Never cancel an in-flight publish (`concurrency.cancel-in-progress: false`)

### 10.3 SDK backend deploy

- **Option A repo:** Render service auto-deploys on push to `main` (dashboard setting)
- **Option B repo:** same, from the private repo
- No version tag needed for the edge (it has no public artifact); GitHub Release optional
- Rollback = Render manual rollback to previous deploy

### 10.4 Human release checklist (per SDK version)

1. CHANGELOG updated + PR merged, CI green
2. Bump version in manifest (+ `SDK_VERSION` constants)
3. `git tag sdk-nodejs-v0.2.0 && git push origin sdk-nodejs-v0.2.0`
4. Watch the Release workflow; verify GitHub Release created
5. `npm view @quantiqen/sdk version` / `pip index versions quantiqen-sdk` shows the new version

---

## 11. Launch Verification

- [ ] `curl https://api.quantiqen.com/health` → 200
- [ ] `curl https://api.quantiqen.com/ready` → 200 (platform reachable)
- [ ] Fresh VM/venv: `npm install @quantiqen/sdk` → quickstart script sends a bulk batch →
      platform dashboard shows events (acceptedCount > 0)
- [ ] Same for `pip install quantiqen-sdk`
- [ ] Negative paths: no key → 400; revoked key → 401 passthrough; oversized batch → 413/422
- [ ] `npm view @quantiqen/sdk license repository` shows MIT + working repo URL (no 404)
- [ ] PyPI project page renders README correctly

---

## 12. Post-Launch Maintenance

- SDK version bumps ship with CHANGELOG entries; platform breaking changes to
  `/api/v1/events*` require an SDK major bump and a coordinated edge release
- Monitor: platform `GET /status` (Integrations component), edge logs for `UPSTREAM_*` codes,
  registry download counters
- Support channel: GitHub Issues on the public repo
- Deprecation policy: any SDK method removal follows one minor of `deprecated` logging
  before the major removal
- Edge rate-limit/timeout tuning via env only — no code deploy required

---

## 13. Secrets & Commands Appendix

### Secrets (public repo → Settings → Secrets and variables → Actions)

| Secret | Used by | Notes |
|---|---|---|
| `NPM_TOKEN` | `publish-nodejs` job | npm **Automation** token, publish scope, from the `quantiqen` org |
| `PYPI_API_TOKEN` | `publish-python` job | PyPI API token (or switch to Trusted Publishing and drop it) |

### Render env (SDK backend service)

`NESTJS_BASE_URL`, `INTERNAL_PROXY_SECRET`, `CORS_ORIGINS` — set in the Render dashboard,
never committed. `PORT` is injected by Render.

### Commands quick reference

```bash
# SDK backend local dev
cd sdk-backend && cp .env.example .env && npm install
npm run dev            # tsx watch
npm test               # vitest + supertest

# Release an SDK (after CHANGELOG + version bump + CI green)
git tag sdk-nodejs-v0.1.0
git push origin sdk-nodejs-v0.1.0

# Verify published
npm view @quantiqen/sdk version
pip index versions quantiqen-sdk
```

---

## 14. Convention Compliance Notes

The SDK backend is a **deliberate, user-approved stack exception** (plain Express instead of
NestJS) for a thin public edge. It still honors every platform rule that applies to it:

| Rule | How the edge complies |
|---|---|
| No business logic in the edge | Pure proxy — no scoring/detection/decisions, no re-implemented validation |
| Auth is source-of-truth server-side | `X-API-KEY` validated only by NestJS `ApiKeyGuard`; edge does format pre-check only |
| `organization_id` never from client input | Unchanged — NestJS derives it from the key server-side |
| Error envelope `{error:{code,message,request_id}}` | Middleware produces it for edge errors; upstream envelope passed through |
| Structured logging with `request_id` | `request-id` middleware + JSON logger, threaded to upstream via `X-Request-Id` |
| Secrets env-only, never logged | Zod-validated env; API keys redacted in logs |
| Feature-based structure, co-located tests | `src/{middleware,routes,proxy}` + `test/` mirrors platform layout |
| Rate limits + timeouts on outbound calls | `AbortSignal` timeout; no upstream POST retries; per-IP edge limiter |
| Deferred scaling triggers | In-memory limiter until >1 instance; Redis swap is a one-file change |
| SSE/realtime untouched | Remains on NestJS `GET /api/v1/events`; edge does not proxy SSE |

The Node/Python SDKs remain thin clients: batching + retry + throttling only, no parsing
authority, no offline scoring — consistent with "AI/engine explains, never scores" and with
keeping the detection pipeline authoritative on the platform.
