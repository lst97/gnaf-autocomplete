# G-NAF Address Autocomplete

> **Address lookups should be free. Simple as that.**

A self-hosted Australian address autocomplete API powered by Geoscape Australia's open G-NAF dataset. No API keys required from third-party providers, no per-request pricing, no vendor lock-in — just PostgreSQL and Bun.

## Why This Exists

Australia has one of the best open-data address systems in the world. The Geoscape G-NAF (Geocoded National Address File) is published under CC BY 4.0 — 16.0 million addresses covering every state and territory, freely available. Yet almost every address autocomplete service charges per lookup, requires a third-party API key, or phones home to cloud servers.

This project exists because **address lookup is a solved infrastructure problem that should not be monetised per request**. It bundles the G-NAF dataset with a purpose-built query engine into a single self-contained Docker stack: spin it up, load the data once, and you have a production-grade address autocomplete API with no recurring costs and no external dependencies.

- **16.0M addresses** across all 9 Australian states and territories (including Other Territories)
- **<50ms p95** query latency — a multi-tier PostgreSQL index strategy picks the cheapest index per query shape
- **Zero external API dependencies** — no Google, no Mapbox, no AWS. Just PostgreSQL 18 + Bun on your own hardware
- **Fully observable** — built-in OpenAPI 3.1 spec, health endpoints, rolling latency stats, and bundled test UI
- **~9.5 minute data load** — parallel COPY FROM STDIN with 9 concurrent workers loads the full dataset without buffering

## Why Not Google / Mapbox / Here?

| Factor | G-NAF (this project) | Google Places API | Mapbox Geocoding API |
|--------|----------------------|-------------------|----------------------|
| **Cost** | Free (self-hosted) | $200/mo minimum (beyond free tier) | $0.50/1k lookups (pay-as-you-go) |
| **Data** | G-NAF (Australian government, CC BY 4.0) | Google-sourced + third-party | OpenStreetMap + proprietary |
| **Speed** | p95 < 50ms (local) | 100-300ms (network + API overhead) | 100-500ms (network + API overhead) |
| **Privacy** | No data leaves your server | Every query goes to Google | Every query goes to Mapbox |
| **Offline** | 100% offline-capable | Requires internet connection | Requires internet connection |
| **Rate limits** | Self-managed (your hardware, your limits) | 180 lookups/min (free tier) | 300k lookups/mo (free tier) |
| **Deployment** | `docker compose up` | API key + SDK integration | API key + SDK integration |
| **License** | AGPL v3 (this project) + CC BY 4.0 (data) | Proprietary EULA | Proprietary EULA |
| **Vendor lock-in** | None — full data exportable at any time | Significant (proprietary API + data) | Significant (proprietary API) |

**Bottom line**: if you need a one-off lookup from an MVP, any of the paid services will work. If you're building a product that depends on address autocomplete, or if you care about privacy, latency, and cost over 100k+ queries, this project saves you thousands per year. No per-request billing, no surprise overages, no vendor phoning home.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + [Docker Compose](https://docs.docker.com/compose/install/)
- [Bun](https://bun.sh/) 1.2+ (for running the loader directly)
- ~25GB free disk for the PostgreSQL data volume (~27GB after initial load)

## System Requirements

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| **Host RAM** | 16GB free | 32GB+ free | The PostgreSQL container uses up to 16GB during load (COPY FROM STDIN streams without buffering in `shared_buffers`, but the OS file cache fills with staging pages). Other containers / processes need headroom. |
| **Docker memory limit (db service)** | 12GB | 16GB | Set in Docker Desktop → Settings → Resources → Memory. The `docker-compose.yml` requests 20GB but Docker Desktop on Mac caps per-container memory. |
| **CPU cores** | 4 | 8+ | The loader spawns 9 parallel workers (one per state). Each COPY + parallel index build benefits from 4+ cores. |
| **Disk space** | 30GB free | 40GB+ | ~15GB for the MV + indexes, ~5GB for WAL during load, ~5GB for the G-NAF PSV files (~27GB total after initial load). SSD strongly recommended. |
| **PostgreSQL** | 16+ | 18 | Uses `gen_random_uuid()`, `MERGE` (via `INSERT ... ON CONFLICT`), and parallel GIN index builds. The image is `postgres:18-bookworm`. |
| **Bun** | 1.2+ | 1.3+ | For running the loader directly. Uses native `SQL` client for the orchestrator + `postgres` package for COPY FROM STDIN. |

### Memory usage during load

The loader is designed to keep peak memory low by using `COPY FROM STDIN` (via the `postgres` package) instead of bulk INSERTs. This streams data from the file to the heap without buffering in `shared_buffers` or building large parameter arrays in JS.

| Phase | DB container memory | Host free RAM needed |
|-------|--------------------|-----------------------|
| Idling | ~70MB | ~16GB |
| Parallel COPY (9 workers) | ~900MB | ~15GB |
| Denormalization UPDATE (16.0M rows) | ~900MB | ~15GB |
| MV REFRESH (16.0M rows) | ~900MB | ~15GB |
| MV index recreation (4 batches on 6 connections) | ~900MB | ~15GB |

**If you see OOM kills during the load**, the most common cause is Docker Desktop's per-container memory cap. Increase it in Docker Desktop → Settings → Resources → Memory. The 16.0M-row MV needs ~15GB of contiguous memory to load cleanly.

> **🔎 Bundled UI at `http://localhost:8000`** — the API ships a full test interface with live autocomplete, address detail lookup, API key generation and management, the 7-tier query router reference with real latency data, loader performance breakdown, system diagnostics, and the complete getting-started guide. After starting the API, open it in your browser.

## Quickstart

```bash
# 1. Start the database
docker compose up -d db

# 2. Load the G-NAF data (~9.5 min for all 9 states with COPY FROM STDIN)
docker compose run --rm api bun run scripts/load.ts

# 3. Start the API
docker compose up -d api

# 4. Test it (health checks don't need an API key; /suggest does)
curl http://localhost:8000/healthz
curl http://localhost:8000/readyz
curl http://localhost:8000/openapi.json

# 5. Generate an API key at /keys in the bundled UI, then query /suggest
curl "http://localhost:8000/suggest?q=12+main+st+sydney" \
  -H "X-API-Key: gnaf_pk_abc123..." \
  -H "Referer: https://myapp.com"

# 6. Run the benchmark
bun run benchmark/bench.ts
```

## API Reference

All data endpoints require an `X-API-Key` header (except `/healthz`, `/readyz`, `/openapi.json`, `/docs`).

### `GET /suggest`

Address autocomplete. **Auth required**: `X-API-Key` header. The `Referer` (or `Origin`) header must match the key's registered domain.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `q` | string | ✅ | Search query (min 2 characters, max 200) |
| `state` | string | ❌ | State filter: `NSW`, `VIC`, `QLD`, `WA`, `SA`, `TAS`, `ACT`, `NT`, `OT` (closed-set Levenshtein-1 correction) |
| `postcode` | string | ❌ | Postcode filter (exactly 4 digits) |
| `limit` | number | ❌ | Max results (default 10, max 50) |
| `offset` | number | ❌ | Pagination offset (max 1000) |
| `no_cache` | string | ❌ | Set to `"1"` to bypass the in-process LRU (used by benchmarks) |

**Response (200):**
```json
{
  "results": [
    {
      "id": "GANSW706063331",
      "display": "12 MAIN ST, SYDNEY NSW 2000",
      "locality": "SYDNEY",
      "lat": -33.8618,
      "lon": 151.2083,
      "state": "NSW",
      "postcode": "2000",
      "score": 0.43
    }
  ],
  "tier": "tier1",
  "took_ms": 8,
  "cache_status": "hit",
  "meta": {
    "took_ms": 12,
    "request_id": "...",
    "timestamp": "..."
  }
}
```

`score` formula: `similarity × (1 + ln(confidenceNorm + 1))` where `similarity` is 0–1 (trigram text match, 1.0 for btree tiers) and `confidenceNorm` normalises G-NAF `CONFIDENCE` (6→1.0, 0→0.14, NULL→0.5, -1→0.3). Range: 0 to ~1.69.

Optional correction fields: `corrected_from` (street), `locality_corrected_from` (suburb), `state_corrected_from` (state) — set when the in-memory SymSpell corrector rewrites a typo before the DB query.

### Other Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /healthz` | None | Liveness probe — returns 200 if the process is running |
| `GET /readyz` | None | Readiness probe — checks DB connection + MV populated |
| `GET /openapi.json` | None | OpenAPI 3.1 spec (auto-generated) |
| `GET /docs` | None | Swagger UI (Scalar) |
| `GET /address/:id` | Required | Full address record by `address_detail_pid` |
| `POST /warmup` | None | Pre-warm 7 hot indexes into `shared_buffers` (idempotent) |
| `GET /keys` | None | Generate a domain-bound API key (HTML page, not API) |
| `GET /api/stats` | None | Public usage statistics |
| `GET /analytics` | None | Standalone public analytics dashboard |

## Architecture

```
┌─────────────┐     ┌─────────────────────────────┐     ┌────────────┐
│  Bun/Elysia │ ──► │ address_search_mv (MV)      │ ◄── │ PostgreSQL │
│  HTTP API   │     │  + 10 indexes (1 UNIQUE +   │     │    18      │
│  7-tier     │     │   4 btree covering + 1      │     │            │
│  router     │     │   btree prefix + 2 GIN      │     │            │
└─────────────┘     │   street/locality + 1       │     └────────────┘
                    │   GIN search_text + 1 GIN   │
                    │   tsvector (vestigial))     │
                    └─────────────────────────────┘
                              ▲
                              │ REFRESH MATERIALIZED VIEW
                              ▼
                    ┌─────────────────────────────┐
                    │ 5 staging tables            │
                    │ (state, locality, street,   │
                    │  address_detail, geocode)   │
                    │ Loaded via COPY FROM STDIN  │
                    │ 9 parallel Bun.spawn workers│
                    └─────────────────────────────┘
```

The MV heap is **3.3GB**, all 10 indexes total **~12GB** (one row in the storage report above shows `~15GB` for MV + indexes combined).

### Query Router (7-tier index strategy)

Every query goes through a hardcoded decision tree that picks the cheapest index matching what the user typed:

| Tier | Trigger | p50 | p95 | avg | Index |
|------|---------|-----|-----|-----|-------|
| `tier0_locality` | State + locality prefix (e.g. `syd nsw`) | 4.4ms | 7.6ms | 4.4ms | btree `(state, locality_lc text_pattern_ops)` |
| `tier1` | Street name prefix (any alphabetic token ≥1 char) | 8.2ms | 10.5ms | 8.1ms | btree `(street_lc text_pattern_ops, confidence DESC)` |
| `tier0` | State + postcode equality (e.g. `sydney nsw 2000`) | 9.8ms | 23.1ms | 12.4ms | btree `(state, postcode)` incl. confidence |
| `postcode` | Purely numeric 2-4 digit query | 14.4ms | 23.4ms | 15.0ms | btree `(postcode text_pattern_ops)` |
| `tier4` | Multi-word GIN trigram fallback (rare — most queries route to tier1) | 16.6ms | 19.3ms | 9.7ms | GIN on `street_lc` + `locality_lc` individually |
| `tier2` | Single-word trigram fallback | 6.8ms | 17.8ms | 6.8ms | GIN on `search_text_expanded` |
| `tier0_number` | State + street number (e.g. `1090 vic`) | 30.7ms | 68.6ms | 27.9ms | btree `(state, number_first)` |
| `typo_corrected` | Street/state/locality typo → SymSpell corrector → tier1 | ~8ms | ~10ms | — | same as tier1 (corrector runs before DB query) |
| `↺ cache` | Repeated query via in-process LRU | <1ms | <1ms | <1ms | TTL-cached in-memory Map |

Tier 3 (GIN tsvector FTS) was removed as vestigial — trigram tiers cover all cases. The tier1 prefix threshold was lowered to 1 char (was 3) so even short inputs like `"y st"` and `"pi st"` hit the fast btree index instead of the slow GIN trigram index.

## Configuration

Copy `.env.example` to `.env` and edit. Source of truth: `src/env.ts` (Zod schema).

| Variable | Default | Description |
|----------|---------|-------------|
| **Server** |||
| `PORT` | `8000` | API server port |
| `PUBLIC_URL` | *(empty)* | Public URL of the API (used for same-origin bypass) |
| `NODE_ENV` | `development` | `development`, `production`, or `test` |
| `LOG_LEVEL` | `info` | trace, debug, info, warn, error, fatal |
| `CORS_ORIGINS` | `*` | Allowed CORS origins (comma-separated or `*`) |
| **PostgreSQL** |||
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5433/gnaf` | Primary PostgreSQL connection string |
| `DATABASE_URL_READWRITE` | *(same)* | Separate write connection (optional) |
| `POOL_SIZE` | `10` | Connection pool size (1–100) |
| `POSTGRES_PASSWORD` | `postgres` | Docker Compose only — sets the `postgres` user's password |
| **Suggest Cache** |||
| `SUGGEST_CACHE_MAX` | `1000` | Max entries in the in-process LRU |
| `SUGGEST_CACHE_TTL_MS` | `30000` | Cache TTL in ms (1s–1h) |
| **API Key Rate Limiting** |||
| `API_KEY_RATE_LIMIT` | `5000` | Max requests per hour per key |
| `API_KEY_RATE_WINDOW_MS` | `3600000` | Rate limit window in ms (default 1h) |
| `KEYGEN_RATE_LIMIT` | `10` | Max key generation per hour per IP |
| `KEYGEN_RATE_WINDOW_MS` | `3600000` | Keygen rate limit window in ms (default 1h) |
| `MAX_KEYS_PER_DOMAIN` | `5` | Max active + pending API keys per domain |
| `DOMAIN_SPAM_TLDS` | `.tk .ml .ga …` | Blocked TLDs for key registration |
| **Cloudflare Turnstile** |||
| `TURNSTILE_SITE_KEY` | *(empty)* | Turnstile site key (test key in dev) |
| `TURNSTILE_SECRET_KEY` | *(empty)* | Turnstile secret key (test key in dev) |
| **G-NAF Data** |||
| `GNAF_DATA_DIR` | *(empty)* | Path to the G-NAF PSV files (used by the loader) |
| `GNAF_VERSION` | `MAY 2026` | Display label for the loaded G-NAF release |
| **Deployment** |||
| `CF_TUNNEL_TOKEN` | *(empty)* | Cloudflare Tunnel token for `cloudflared` (Docker Compose only) |

## Quarterly Refresh

Geoscape Australia publishes G-NAF ~4×/year (Feb, May, Aug, Nov).

```bash
# 1. Download the new release from https://data.gov.au
# 2. Extract to a directory

# 3. Set the data dir and re-run the loader
export GNAF_DATA_DIR=/path/to/new/G-NAF/G-NAF\ XXX\ 2026/Standard
docker compose run --rm api bun run scripts/load.ts

# 4. Restart the API
docker compose restart api

# 5. Verify
bun run benchmark/bench.ts
```

Estimated refresh time: **~9.5 minutes (570s)** — 177s worker COPY (9 parallel) · 121s denormalization UPDATE · 143s MV REFRESH · 99s parallel index rebuild (6 connections) · 19s pre-filter + staging · 13s prewarm + cleanup. The loader is **idempotent**: it checks `pg_matviews.ispopulated` and `information_schema.tables` to skip schema setup if already applied, so a regular refresh is just *point the loader at new PSVs and re-run*. `docker compose down -v` is only needed for schema changes or the first deploy. See the **📦 Loader** tab in the bundled UI for the full phase breakdown.

## Performance

| Metric | Target | Actual | Notes |
|--------|--------|--------|-------|
| p95 latency | <50ms | 26.4ms (cold cache, 1000 mixed queries) | End-to-end, all 7 tiers, no warmup, `?no_cache=1`. SHA-256 key verify ~1ms. Tier1 btree runs ~8-11ms; tier4 trigram ~16-20ms. |
| p50 latency | — | 7.0ms | |
| p99 latency | — | 28.3ms | |
| Load time | <12 min | ~9.5 min (570s) | Full 16.0M rows on M5 Pro Mac (48GB host, 16GB Docker). Breakdown: 177s worker COPY (9 parallel), 121s denormalization UPDATE, 143s MV REFRESH, 99s parallel index rebuild (6 connections), 19s pre-filter + staging, 13s prewarm + cleanup. |
| MV heap | ~5GB | 3.3GB | `address_search_mv` heap with 16.0M rows |
| Index size | ~13GB | 12GB | 10 indexes: 1 UNIQUE + 4 btree covering (tier0 state+postcode, tier0 state+number, tier0 state+locality, tier1 street+prefix) + 1 btree postcode prefix + 2 GIN trigram street/locality (tier4) + 1 GIN trigram search_text (tier2) + 1 GIN tsvector (tier3 vestigial) |
| DB disk | ~25GB | 27GB | 15GB MV+indexes + 5GB WAL + 5GB G-NAF PSV files (measured on deployed container) |
| Loader peak memory | <1GB | ~900MB | COPY FROM STDIN streams data without buffering in `shared_buffers`. Denormalization UPDATE and REFRESH also stay under 900MB. |
| Loader workers | 9 (one per state) | 9 | ACT, NSW, NT, OT, QLD, SA, TAS, VIC, WA |
| Test suite | — | 476 tests, 0 failures | 417 unit (router, tokenizer, scorer, cache, etc.) + 59 integration (live API) |

## Benchmarks

Run `bun run benchmark/bench.ts` after loading the data. Expected results on a **MacBook Pro M5 Pro (48GB)** · **macOS 26.5.1** · **Bun 1.3.14** · **Postgres 18-bookworm (Docker)** · **16.0M addresses** — **31 distinct query shapes, cold cache (`?no_cache=1`)**:

```
Running 1000 queries...

  p50: 7.0ms
  p95: 26.4ms
  p99: 28.3ms
  avg: 9.6ms
  max: 34.0ms

✅ PASS: p95 (26.4ms) is under 50ms target
```

**Note:** The benchmark uses `?no_cache=1` to bypass the in-process LRU. Results reflect cold-cache latency (`shared_buffers` may still be warm from `pg_prewarm`). Repeated queries are <1ms with the cache. The tier1 prefix requirement was lowered to 1 char (was 3), so most queries (including `"y st"` and `"pi st"`) now hit the fast btree index instead of the slow GIN trigram index. Run `bun run benchmark/tiers.ts` for a per-tier breakdown.

## Per-Tier Latency

After the SHA-256 auth middleware (~1ms), tier times differentiate clearly (benchmarked on **MacBook Pro M5 Pro (48GB)** · **macOS 26.5.1** · **Bun 1.3.14** · **Postgres 18-bookworm (Docker)** · **16.0M addresses**):

| Tier | Trigger | p50 | p95 | avg |
|------|---------|-----|-----|-----|
| `tier0_locality` | State + locality prefix | 4.4ms | 7.6ms | 4.4ms |
| `tier1` | Street name prefix (≥1 char) | 8.2ms | 10.5ms | 8.1ms |
| `tier0` | State + postcode equality | 9.8ms | 23.1ms | 12.4ms |
| `postcode` | Purely numeric 2-4 digit query | 14.4ms | 23.4ms | 15.0ms |
| `tier4` | Multi-word GIN trigram fallback (rare) | 16.6ms | 19.3ms | 9.7ms |
| `tier2` | Single-word GIN trigram fallback | 6.8ms | 17.8ms | 6.8ms |
| `tier0_number` | State + street number | 30.7ms | 68.6ms | 27.9ms |
| `typo_corrected` | Street/state/locality typo → corrector → tier1 | ~8ms | ~10ms | — |
| `↺ cache` | In-process LRU hit (repeated queries) | <1ms | <1ms | <1ms |

Numbers reflect **cold-cache** latency (`?no_cache=1`). See the **System** tab in the bundled UI for the full router flow diagram with in-depth index descriptions and the per-tier p50/p95 breakdown.

## API Key Hashing

API keys are hashed with **SHA-256** — a deliberate choice over bcrypt or argon2id. The raw key is a 32-byte CSPRNG token (~2²⁵⁶ entropy), making offline brute force infeasible even at GPU speeds (~10⁹ SHA-256/s). A slow KDF would add 50-100ms per request, which is unacceptable on the auth hot path (every `/suggest` and `/address/:id` request must verify the key). SHA-256 verification completes in ~1ms and uses constant-time comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.

## G-NAF License

This dataset is the **Geocoded National Address File (G-NAF)** from **Geoscape Australia**, available on [data.gov.au](https://data.gov.au/data/dataset/geocoded-national-address-file-g-naf).

- G-NAF © Geoscape Australia
- Licensed under **Creative Commons Attribution 4.0 International (CC BY 4.0)** — with an additional **mail-use restriction** (see below).
- [End User Licence Agreement (PDF)](https://data.gov.au/data/dataset/19432f89-dc3a-4ef3-b943-5326ef1dbecc/resource/09f74802-08b1-4214-a6ea-3591b2753d30/download/20160226-eula-open-g-naf.pdf)
- [Fact Sheet — Open G-NAF Use Restriction (PDF)](https://data.gov.au/data/dataset/19432f89-dc3a-4ef3-b943-5326ef1dbecc/resource/9a8f6baa-f790-49a0-84b1-3cb39a6a1b88/download/fact-sheet-open-g-naf-use-restriction.pdf)

**Mail-use restriction:** The open G-NAF data must not be used for the generation of an address or a compilation of addresses for the sending of mail unless the user has verified that each address can receive mail by reference to a secondary source of information. See the [fact sheet](https://data.gov.au/data/dataset/19432f89-dc3a-4ef3-b943-5326ef1dbecc/resource/9a8f6baa-f790-49a0-84b1-3cb39a6a1b88/download/fact-sheet-open-g-naf-use-restriction.pdf) for details.

**Commercial use:** Unlike what some third-party documentation states, the open G-NAF distributed via data.gov.au is under CC BY 4.0 (with the mail-use restriction above), which permits both commercial and non-commercial use with attribution. Verify your specific use case against the [EULA](https://data.gov.au/data/dataset/19432f89-dc3a-4ef3-b943-5326ef1dbecc/resource/09f74802-08b1-4214-a6ea-3591b2753d30/download/20160226-eula-open-g-naf.pdf).

## API Key Authentication

All endpoints except health checks, the key management page, and the OpenAPI spec require a valid API key. Keys are domain-bound — the `Referer` header of each request must match the domain the key was registered for.

### Getting a Key

1. Visit `/keys` in your browser
2. Enter your application domain (e.g., `myapp.com`)
3. Complete the Cloudflare Turnstile challenge
4. Copy the generated key — it will not be shown again

### Using a Key

Pass the key as the `X-API-Key` HTTP header (not a query parameter — the API does not accept key as a query param):

```bash
# X-API-Key header (required) + Referer (must match the key's domain)
curl "http://localhost:8000/suggest?q=sydney" \
  -H "X-API-Key: gnaf_pk_abc123..." \
  -H "Referer: https://myapp.com"
```

Server-side clients (no `Referer` / `Origin`) are allowed but logged as refererless and subject to the per-key rate limit.

### Key Validation Rules

| Scenario | Behaviour |
|---|---|
| Key is valid + `Referer` matches registered domain | ✅ Request proceeds |
| Key is valid + no `Referer` header (server-side client) | ✅ Allowed, logged as refererless, subject to per-key rate limit |
| Key is valid + `Referer` does NOT match | ❌ 403 `DOMAIN_MISMATCH` |
| Key has expired (unused for 90 days) | ❌ 401 `KEY_EXPIRED` |
| Key is revoked | ❌ 403 `KEY_REVOKED` |
| No key provided | ❌ 401 `MISSING_API_KEY` |
| Key exceeds hourly budget | ❌ 429 `KEY_RATE_LIMITED` |
| Self-revoke while other keys exist | ❌ 409 `CANNOT_SELF_REVOKE` |

### Rate Limits

- **Per-key**: 5,000 requests per hour (configurable via `API_KEY_RATE_LIMIT`)
- **Per IP (global)**: 120 requests per minute in production
- **Key generation**: 10 requests per hour per IP

Response headers include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-Key-Status`.

### Key Revocation

Keys can be revoked from the keys management UI or programmatically. Revocation uses the same `X-API-Key` header as other endpoints — you do not need to re-enter the full key for each revoke. The auth key must be in the same domain as the target key.

- **Single key**: `POST /api/keys/:prefix/revoke` with `X-API-Key` header. Self-revocation is gated by a last-key guard: you cannot revoke your own key while other active keys exist (prevents accidental lockout).
- **Bulk revoke (all keys for a domain)**: Via DNS recovery — complete the recovery flow (`POST /api/keys/recover/start` → add TXT record → `POST /api/keys/recover/revoke`). This is the escape hatch when you have lost all keys or need to recover from a stolen-key attack. No `X-API-Key` required — DNS proof is your authority.

### Key Expiry

All API keys have a **90-day sliding-window expiry**:

- New keys are created with `expires_at = now + 90 days`.
- Each successful use pushes the window forward to `now + 90 days` (auto-extension, throttled to fire only when within the last 30 days of the window).
- A key unused for 90 consecutive days expires and returns `401 KEY_EXPIRED`.
- Expired keys must be replaced (no renewal endpoint).
- Existing keys from a previous deployment are unaffected — the column defaults apply only to newly generated keys.

## Production Deployment

### Environment Checklist

| Variable | Development | Production |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5433/gnaf` | Use a strong password, never commit |
| `CORS_ORIGINS` | `*` | `https://your-frontend.com` |
| `LOG_LEVEL` | `info` | `warn` in production to reduce log volume |
| `POOL_SIZE` | `10` | `20-50` depending on concurrency |
| `NODE_ENV` | unset | `production` |
| `PORT` | `8000` | `8000` (or behind Cloudflare Tunnel) |
| `TURNSTILE_SITE_KEY` | `1x00000000000000000000AA` (test key) | Your Cloudflare Turnstile site key |
| `TURNSTILE_SECRET_KEY` | `1x00000000000000000000AA` (test key) | Your Cloudflare Turnstile secret key |
| `CF_TUNNEL_TOKEN` | unset | Cloudflare Tunnel token |

### Deployment Requirements

Before deploying to production, verify the following:

1. **Reverse proxy / Cloudflare Tunnel.** The API is designed to run behind Cloudflare Tunnel (or any reverse proxy that sets a trusted client IP header). Without a proxy, per-IP rate limiting uses the socket peer address, which may be the proxy's IP in a load-balanced setup. See the Cloudflare Tunnel section below for recommended deployment.

2. **TLS to PostgreSQL.** In production, both `DATABASE_URL` and `DATABASE_URL_READWRITE` must include `sslmode=require` (or `verify-full`/`verify-ca`). The server logs a `WARN` at startup if either URL lacks this. Connections without TLS expose credential traffic to the network.

3. **`POSTGRES_PASSWORD` environment variable.** The `db` service in `docker-compose.yml` requires `POSTGRES_PASSWORD` to be set in the environment. Generate one with `openssl rand -base64 32`. Never use the default value `postgres` in production.

4. **Database volume reset on pre-launch deploy.** This service is pre-launch — on the first production deploy, reset the DB volume to pick up the new schema and roles:
   ```bash
   docker compose down -v && docker compose up -d db
   ```
   All pre-existing API keys must be regenerated after the reset.

### Cloudflare Tunnel Deployment

The API can be deployed behind [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for zero open ports, DDoS protection, and automatic TLS.

#### Setup

```bash
# 1. Install cloudflared and authenticate
cloudflared tunnel login

# 2. Create a tunnel
cloudflared tunnel create gnaf-api

# 3. Route DNS
cloudflared tunnel route dns gnaf-api api.yourdomain.com

# 4. Get the tunnel token
cloudflared tunnel token gnaf-api

# 5. Set the token in your environment
export CF_TUNNEL_TOKEN=eyJ...
```

#### Run

```bash
docker compose --profile production up -d tunnel
```

The tunnel service connects outbound to Cloudflare's edge — no inbound firewall ports needed. The API is reachable at `https://api.yourdomain.com`.

#### Recommended WAF Rules (Cloudflare Dashboard)

| Rule | Effect |
|---|---|
| Rate limit: 200 req/min per IP | Protects against IP-based abuse at the edge |
| Block non-browser `User-Agent` on `/keys` | Prevents scripted key generation |
| Block requests missing `User-Agent` | Filters basic scrapers |
| Enable "I'm Under Attack" mode | During DDoS events |

### Security Hardening

1. **Cloudflare Tunnel**: Deploy behind Cloudflare Tunnel. Do not expose the API directly to the internet. The tunnel establishes an outbound-only connection — no open ports.
2. **API key authentication**: All data-bearing endpoints (`/suggest`, `/address/:id`) require a domain-bound API key. Get one at `/keys`.
3. **Rate limiting**: IP-based (120 req/min) + per-key (1,000 req/hr) layered defense. Key generation is limited to 10 req/hr per IP.
4. **CORS**: Set `CORS_ORIGINS` to the exact frontend origin. Never use `*` in production.
5. **Turnstile**: Key generation requires a Cloudflare Turnstile challenge, preventing automated key harvesting.
6. **EULA**: Ensure you have a valid Geoscape Australia End User Licence Agreement before deploying with live G-NAF data.

### Backup and Restore

The critical data is the `address_search_mv` materialized view (16.0M rows, 3.3GB heap + 12GB indexes = ~15GB). The staging tables are ephemeral and don't need backup. The total `pgdata` volume is ~27GB (MV + indexes + WAL + overhead).

```bash
# Backup (takes ~5 min for 27GB volume)
docker compose exec -T db pg_dump -U postgres -d gnaf \
  --table=address_search_mv \
  --no-owner \
  --compress=9 \
  -f /tmp/gnaf_backup.sql.gz

# Copy backup off the container
docker compose cp db:/tmp/gnaf_backup.sql.gz ./backups/

# Restore (requires empty MV)
docker compose exec -T db psql -U postgres -d gnaf \
  -c "TRUNCATE address_search_mv;"
gunzip -c ./backups/gnaf_backup.sql.gz | \
  docker compose exec -T db psql -U postgres -d gnaf
```

### Quarterly G-NAF Refresh

Geoscape publishes 4 releases per year. Run the loader with the new data:

```bash
# 1. Download new G-NAF release
# 2. Update GNAF_DATA_DIR
# 3. Run the loader (destructive — TRUNCATEs staging, refreshes MV)
docker compose run --rm -e GNAF_DATA_DIR=/path/to/new/data api bun run scripts/load.ts
# 4. Restart the API
docker compose restart api
# 5. Verify
bun run benchmark/bench.ts
```

### Monitoring

- **`/healthz`**: Liveness — returns 200 if the process is running
- **`/readyz`**: Readiness — returns `status: "ready"` with `mv_populated: true` when fully operational
- **`/warmup`**: POST to this endpoint after deployment to load indexes into cache
- **Logs**: JSON structured logs via pino. Look for `suggest_stats` lines (p50/p95/p99 every 100 requests)
- **Disk**: The `pgdata` volume grows to ~27GB after the initial load (15GB MV+indexes + 5GB WAL + 5GB G-NAF PSVs). Monitor with `docker system df`

### Scaling

The API is stateless — scale horizontally by running more containers behind a load balancer. The database is the bottleneck. For higher throughput:
- Increase `POOL_SIZE` in `.env` (up to 50)
- Add a read replica for the MV
- Use PgBouncer for connection pooling at scale

## Troubleshooting

| Problem | Check |
|---------|-------|
| `docker compose up` fails with "exit code 137" | Docker memory limit too low. The DB container needs 16GB minimum. |
| Loader reports "Skipping" for PSV files | `GNAF_DATA_DIR` points to the wrong directory. Verify the path contains `*_ADDRESS_DETAIL_psv.psv` files. |
| `/suggest` returns empty results | Run `docker compose run --rm api bun run scripts/load.ts` to load the data. |
| `/healthz` returns 200 but `/readyz` fails | Database is not reachable from the API container. Check `DATABASE_URL`. |
| `/suggest` returns 401 `MISSING_API_KEY` | The API key is required via the `X-API-Key` header (not a query parameter). Generate a key at `/keys` in the bundled UI. |
| `DOMAIN_MISMATCH` 403 on `/suggest` | The `Referer` (or `Origin`) header must match the key's registered domain. |
| Tier buttons in UI don't show `↺ cache` badge on re-click | The test UI's `apiFetch()` uses `cache: "no-store"` to bypass the browser HTTP cache. If you see stale `took_ms` values, hard-refresh the page. |
| Benchmark p95 > 50ms | Run `pg_prewarm` (already runs on container startup). Check `shared_buffers` in `postgresql.conf`. |
