# G-NAF Address Autocomplete

A fast, self-contained backend for Australian address autocomplete using Geoscape Australia's G-NAF (Geocoded National Address File) dataset.

- **16.9M addresses** across all 9 Australian states/territories
- **<50ms p95** query latency using a multi-tier PostgreSQL index strategy
- **Zero external runtime dependencies** — just PostgreSQL 18 + Bun
- **Auto-generated OpenAPI 3.1 spec** for frontend codegen
- **Parallel loader** with COPY FROM STDIN completes a full data load in ~10 minutes on a 16GB container (9 parallel workers, orchestrated denormalization, parallel index rebuild)

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) + [Docker Compose](https://docs.docker.com/compose/install/)
- [Bun](https://bun.sh/) 1.1+ (for running the loader directly)
- ~20GB free disk for the PostgreSQL data volume

## System Requirements

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| **Host RAM** | 16GB free | 32GB+ free | The PostgreSQL container uses up to 16GB during load (COPY FROM STDIN streams without buffering in `shared_buffers`, but the OS file cache fills with staging pages). Other containers / processes need headroom. |
| **Docker memory limit (db service)** | 12GB | 16GB | Set in Docker Desktop → Settings → Resources → Memory. The `docker-compose.yml` requests 20GB but Docker Desktop on Mac caps per-container memory. |
| **CPU cores** | 4 | 8+ | The loader spawns 9 parallel workers (one per state). Each COPY + parallel index build benefits from 4+ cores. |
| **Disk space** | 25GB free | 40GB+ | ~15GB for the MV + indexes, ~5GB for WAL during load, ~5GB for the G-NAF PSV files. SSD strongly recommended. |
| **PostgreSQL** | 16+ | 18 | Uses `gen_random_uuid()`, `MERGE` (via `INSERT ... ON CONFLICT`), and parallel GIN index builds. The image is `postgres:18-bookworm`. |
| **Bun** | 1.1+ | 1.3+ | For running the loader directly. Uses native `SQL` client for the orchestrator + `postgres` package for COPY FROM STDIN. |

### Memory usage during load

The loader is designed to keep peak memory low by using `COPY FROM STDIN` (via the `postgres` package) instead of bulk INSERTs. This streams data from the file to the heap without buffering in `shared_buffers` or building large parameter arrays in JS.

| Phase | DB container memory | Host free RAM needed |
|-------|--------------------|-----------------------|
| Idling | ~70MB | ~16GB |
| Parallel COPY (9 workers) | ~900MB | ~15GB |
| Denormalization UPDATE (16M rows) | ~900MB | ~15GB |
| MV REFRESH (16M rows) | ~900MB | ~15GB |
| MV index recreation (8 parallel) | ~900MB | ~15GB |

**If you see OOM kills during the load**, the most common cause is Docker Desktop's per-container memory cap. Increase it in Docker Desktop → Settings → Resources → Memory. The 16M-row MV needs ~15GB of contiguous memory to load cleanly.

## Quickstart

```bash
# 1. Start the database
docker compose up -d db

# 2. Load the G-NAF data (~10 min for all 9 states with COPY FROM STDIN)
docker compose run --rm api bun run scripts/load.ts

# 3. Start the API
docker compose up -d api

# 4. Test it
curl http://localhost:8000/suggest?q=12+main+st+sydney
curl http://localhost:8000/suggest?q=sydne+NSW
curl http://localhost:8000/suggest?q=12+sydney&state=NSW
curl http://localhost:8000/healthz
curl http://localhost:8000/openapi.json

# 5. Run the benchmark
bun run benchmark/bench.ts
```

## API Reference

### `GET /suggest`

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `q` | string | ✅ | Search query (min 2 characters, max 200) |
| `state` | string | ❌ | State filter (NSW, VIC, QLD, WA, SA, TAS, ACT, NT, OT) |
| `postcode` | string | ❌ | Postcode filter (exactly 4 digits) |
| `limit` | number | ❌ | Max results (default 10, max 50) |

**Response (200):**
```json
{
  "results": [
    {
      "id": "GANSW706123456",
      "display": "12 MAIN ST, SYDNEY NSW 2000",
      "lat": -33.8688,
      "lon": 151.2093,
      "state": "NSW",
      "postcode": "2000",
      "score": 0.87
    }
  ],
  "took_ms": 12
}
```

### `GET /healthz` — liveness probe
### `GET /readyz` — readiness probe (checks DB connection)
### `GET /openapi.json` — OpenAPI 3.1 spec (auto-generated)
### `GET /docs` — Swagger UI

## Architecture

```
┌─────────────┐     ┌─────────────────────────────┐     ┌────────────┐
│  Bun/Elysia │ ──► │ address_search_mv (MV)      │ ◄── │ PostgreSQL │
│  HTTP API   │     │  + 6 indexes (4 btree + 2   │     │    16      │
└─────────────┘     │   GIN covering)             │     └────────────┘
                    └─────────────────────────────┘
                              ▲
                              │ REFRESH MATERIALIZED VIEW
                              ▼
                    ┌─────────────────────────────┐
                    │ 5 staging tables            │
                    │ (state, locality, street,   │
                    │  address_detail, geocode)   │
                    │ Loaded via COPY from PSV    │
                    │ 9 parallel Bun.spawn workers│
                    └─────────────────────────────┘
```

### Query Router (multi-tier index strategy)

| Tier | Index | Query Pattern | Latency |
|------|-------|---------------|---------|
| Tier 0 | btree `(state, postcode)` | State + postcode filter | <1ms |
| Tier 0b | btree `(state, locality_lc)` | State + locality prefix | <5ms |
| Tier 0c | btree `(state, number_first)` | State + street number | <1ms |
| Tier 1 | btree `street_lc` | Street name prefix | 1-3ms |
| Tier 2 | GIN trigram `search_text` | Typo-tolerant / fuzzy | 10-30ms |
| Tier 3 | GIN tsvector `search_text` | FTS prefix-only | 10-30ms |

## Configuration

Copy `.env.example` to `.env` and edit:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8000` | API server port |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5433/gnaf` | PostgreSQL connection string |
| `POOL_SIZE` | `10` | Connection pool size |
| `GNAF_DATA_DIR` | *(path to PSVs)* | Directory containing the G-NAF PSV files |
| `LOG_LEVEL` | `info` | Logging level (trace, debug, info, warn, error, fatal) |
| `CORS_ORIGINS` | `*` | Allowed CORS origins (comma-separated or `*`) |

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

Estimated refresh time: **~10 minutes** (~3 min COPY + ~2 min denormalization + ~2.5 min MV REFRESH + ~1.5 min parallel index rebuild + ~0.5 min prewarm + cleanup). Actual: 570s on M5 Pro Mac (48GB RAM, 16GB Docker). See the 📦 Loader tab in the test UI for the full phase breakdown.

## Performance

| Metric | Target | Actual | Notes |
|--------|--------|--------|-------|
| p95 latency | <50ms | 26ms (cold cache) | End-to-end, all tiers, no warmup. Auth middleware (SHA-256 key verify) ~1ms. DB tier time dominates for fast tiers (5-15ms), trigram tiers (tier2/4) still 50-800ms. |
| Load time | <12 min | ~9.5 min (570s) | Full 16M rows on M5 Pro Mac (48GB host, 16GB Docker). Breakdown: 177s worker COPY (9 parallel), 121s denormalization UPDATE, 143s MV REFRESH, 99s parallel index rebuild, 19s pre‑filter + staging, 13s prewarm + cleanup. |
| MV size | ~15GB | 15GB | `address_search_mv` heap with 16M rows + 8 indexes |
| Index size | ~13GB | 12.5GB | 8 indexes: 6 btree (covering) + 2 GIN (trigram + tsvector) |
| DB disk | ~20GB | 20GB | MV + indexes + WAL + overhead |
| Loader peak memory | <1GB | ~900MB | COPY FROM STDIN streams data without buffering in `shared_buffers`. Denormalization UPDATE and REFRESH also stay under 900MB. |

## Benchmarks

Run `bun run benchmark/bench.ts` after loading the data. Expected results on M-series Mac with 16GB+ RAM:

```
Running 1000 queries...

  p50: 8.9ms
  p95: 25.6ms
  p99: 27.7ms
  avg: 11.3ms
  max: 56.3ms

✅ PASS: p95 (25.6ms) is under 50ms target
```

**Note:** The benchmark uses `?no_cache=1` to bypass the in-process LRU. Results reflect cold-cache latency (`shared_buffers` may still be warm from `pg_prewarm`). Numbers are consistent across runs once `shared_buffers` is populated. The dominant cost is the trigram tier (`tier4` ~800ms) — a full benchmark run includes 31 distinct query shapes that exercise all tiers.

## Per-Tier Latency

Run `bun run benchmark/tiers.ts` to see per-tier breakdown. After SHA-256 auth middleware (~1ms), tier times differentiate clearly:

| Tier | Trigger | p50 | p95 |
|------|---------|-----|-----|
| `tier0_locality` | State + locality prefix | ~5ms | 9ms |
| `tier1` | Street name prefix | ~10ms | 13ms |
| `tier0` | State + postcode | ~10ms | 43ms |
| `postcode` | Purely numeric 2-4 digit | ~16ms | 27ms |
| `tier0_number` | State + street number | ~36ms | 91ms |
| `tier2` | Single-word trigram fallback | ~47ms | 55ms |
| `tier4` | Multi-word trigram fallback | ~798ms | 819ms |
| `↺ cache` | In-process LRU hit | <1ms | <1ms |

## API Key Hashing

API keys are hashed with **SHA-256** (not bcrypt or argon2id) in `src/api/keys-gen.ts`. SHA-256 is sufficient for API keys (random 64-char hex bearer tokens) and adds <1ms per request vs 50-100ms for bcrypt/argon2id. Verification in `src/api/auth.ts` uses `crypto.createHash("sha256")` to recompute and compare.

## G-NAF License

This dataset is the **Geocoded National Address File (G-NAF)** from **Geoscape Australia**.
- G-NAF © Geoscape Australia
- [Geoscape Australia EULA](https://geoscape.com.au/data/g-naf/)
- This data is **free for non-commercial use**. **Commercial use requires a valid license** from Geoscape Australia.
- **Production deployment** of this service with live G-NAF data requires a Geoscape EULA.

## API Key Authentication

All endpoints except health checks, the key management page, and the OpenAPI spec require a valid API key. Keys are domain-bound — the `Referer` header of each request must match the domain the key was registered for.

### Getting a Key

1. Visit `/keys` in your browser
2. Enter your application domain (e.g., `myapp.com`)
3. Complete the Cloudflare Turnstile challenge
4. Copy the generated key — it will not be shown again

### Using a Key

Pass the key as a query parameter or header:

```bash
# X-API-Key header (recommended)
curl "http://localhost:8000/suggest?q=sydney" \
  -H "X-API-Key: gnaf_pk_abc123..." \
  -H "Referer: https://myapp.com"
```

### Key Validation Rules

| Scenario | Behaviour |
|---|---|
| Key is valid + `Referer` matches registered domain | ✅ Request proceeds |
| Key is valid + no `Referer` header (server-side client) | ✅ Allowed, logged as refererless, subject to per-key rate limit |
| Key is valid + `Referer` does NOT match | ❌ 403 `DOMAIN_MISMATCH` |
| Key is revoked | ❌ 403 `KEY_REVOKED` |
| No key provided | ❌ 401 `MISSING_API_KEY` |
| Key exceeds hourly budget | ❌ 429 `KEY_RATE_LIMITED` |

### Rate Limits

- **Per-key**: 1,000 requests per hour (configurable via `API_KEY_RATE_LIMIT`)
- **Per IP (global)**: 120 requests per minute in production
- **Key generation**: 10 requests per hour per IP

Response headers include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-Key-Status`.

### Key Revocation

Keys can be revoked by updating the `api_keys` table directly:

```sql
UPDATE api_keys SET status = 'revoked', revoked_at = now()
WHERE prefix = 'abc12345';
```

All subsequent requests with that key will receive a 403 `KEY_REVOKED` response.

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

The critical data is the `address_search_mv` materialized view (16M rows, ~6GB). The staging tables are ephemeral and don't need backup.

```bash
# Backup (takes ~5 min for 20GB volume)
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
- **Disk**: The `pgdata` volume grows to ~20GB after the initial load. Monitor with `docker system df`

### Scaling

The API is stateless — scale horizontally by running more containers behind a load balancer. The database is the bottleneck. For higher throughput:
- Increase `POOL_SIZE` in `.env` (up to 50)
- Add a read replica for the MV
- Use PgBouncer for connection pooling at scale

## Troubleshooting

| Problem | Check |
|---------|-------|
| `docker compose up` fails with "exit code 137" | Docker memory limit too low. The DB container needs 14GB. |
| Loader reports "Skipping" for PSV files | `GNAF_DATA_DIR` points to the wrong directory. Verify the path contains `*_ADDRESS_DETAIL_psv.psv` files. |
| `/suggest` returns empty results | Run `docker compose run --rm api bun run scripts/load.ts` to load the data. |
| `/healthz` returns 200 but `/readyz` fails | Database is not reachable from the API container. Check `DATABASE_URL`. |
| Benchmark p95 > 50ms | Run `pg_prewarm` (already runs on container startup). Check `shared_buffers` in `postgresql.conf`. |
