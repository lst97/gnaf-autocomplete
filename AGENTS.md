# G-NAF ADDRESS AUTOCOMPLETE

**Generated:** 2026-06-16
**Stack:** Bun 1.3 + Elysia 1.4 + PostgreSQL 18 + pino + zod
**Domain:** Australian address autocomplete (Geoscape G-NAF, 16.0M addresses)
**Target:** p95 < 50ms end-to-end (7-tier query router; measured ~26.4ms cold cache)

## OVERVIEW
Self-contained backend for Australian address autocomplete. Bun + Elysia HTTP API
serves a hardcoded 7-tier query router that picks the cheapest PostgreSQL index
per query shape. Single materialised view `address_search_mv` is the read target.
Quarterly G-NAF refresh via 9-way parallel PSV loader.

## STRUCTURE
```
.
├── src/                # Application source — see src/{api,db,lib,search,sql,types}/AGENTS.md
│   ├── api/            # Elysia HTTP routes (suggest, address, health, warmup, openapi, keys*, static)
│   ├── db/             # postgres.js client + 7-tier query router + SQL helpers
│   ├── lib/            # LRU cache, error classes, pino logger, request-id
│   ├── search/         # tokenizer, scorer, formatter, corrector (pure functions)
│   ├── sql/            # Domain-organized SQL modules (auth, keys, stats, warmup, …)
│   ├── types/          # Shared TS types (AuthContext, ResponseMeta, ErrorResponseBody)
│   ├── env.ts          # @t3-oss/env-core + Zod env schema (single source of truth)
│   └── index.ts        # App entry: middleware composition + route registration
├── sql/                # 13 numbered SQL files: extensions, staging, MV, indexes, prewarm, abbrev, api_keys
├── scripts/            # PSV loader (orchestrator + 9 parallel workers, ~9.5 min for 16M rows)
├── tests/              # bun:test — unit (no DB) + integration (live API) + fixture + db
├── benchmark/          # p50/p95/p99 latency benchmarks + tier verification
├── pages/              # Static HTML/JS/CSS test UI (no build step, no framework)
├── postgresql.conf     # Tuned for 16M-row read-heavy MV workload (jit=off!)
├── Dockerfile          # Multi-stage Bun alpine, non-root user, healthcheck baked in
└── docker-compose.yml  # 2GB shm, C locale, 14GB db memory limit
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add HTTP endpoint | `src/api/` | New file → `export const xxxRoute = new Elysia()` → register in `src/index.ts` via `.use()` |
| Add query tier | `src/db/queries.ts` | New fn returning `sql\`...\``; add branch in `src/db/router.ts` decision tree |
| Add new index | `sql/007_mv.sql` | Must use `text_pattern_ops` for btree prefix; add prewarm entry in `sql/005_prewarm.sql` |
| Change scoring | `src/search/scorer.ts` | Formula: `sim * (1 + ln(confidenceNorm + 1))`; MUST also update SQL `ORDER BY` in `src/db/queries.ts` |
| Update loader for new G-NAF | `scripts/load-worker.ts` | Hardcoded PSV column indices — verify against new headers |
| Run all tests | `bun test` | Unit + integration; integration skips if API offline |
| Verify performance | `bun run benchmark/bench.ts` | Exits 1 if p95 > 50ms |
| Verify tier routing | `bun run benchmark/verify-tiers.ts` | Mismatches mean router or test UI is stale |
| Deploy | `docker compose up -d db` → loader → `docker compose up -d api` → `POST /warmup` |

## CODE MAP (key symbols)
| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `routeQuery` | function | `src/db/router.ts` | Hardcoded 7-tier decision tree |
| `tokenizeQuery` | function | `src/search/tokenizer.ts` | Parses `1/6 fortuna` style, extracts flat type, state, postcode |
| `buildDisplay` | function | `src/search/formatter.ts` | Composes uppercase AU address string |
| `computeScore` | function | `src/search/scorer.ts` | `sim * (1 + ln(1 + conf))` — 0 to ~1.69 |
| `LruCache` | class | `src/lib/cache.ts` | Pure-Map TTL LRU; singleton via `getSuggestCache()`; 1000 entries, 30s TTL |
| `expand_address_abbrevs()` | SQL fn | `sql/003c_expand_fn.sql` | `MAIN ST` → `MAIN STREET` for trigram match (vestigial; MV uses LATERAL JOIN) |
| `address_search_mv` | matview | `sql/007_mv.sql` | Single hot read target; 10 indexes (1 UNIQUE + 9 others); `CONCURRENTLY` refreshable |
| `sanitizeQuery` | function | `src/api/suggest.ts` | `/[^a-zA-Z0-9\s\-',./]/g` — strips SQL/XSS chars |
| `isValidAddressQuery` | function | `src/api/suggest.ts` | Rejects invalid input before DB roundtrip (≥2 chars, no pure-state, no 3+ consecutive digits) |
| `correctStateToken` | function | `src/search/tokenizer.ts` | Levenshtein-1 against 9 AU state codes (used in 2 places: query token + `?state=` param) |
| `getCorrector` / `ensureCorrector` | function | `src/search/corrector.ts` | SymSpell street+locality corrector (~210MB, ~3s startup) |

## CONVENTIONS
- **Module type**: ESM (`"type": "module"`); uses `bun run` (not `ts-node`/`tsx`)
- **Test runner**: `bun:test` (NOT Jest, NOT Mocha) — `describe / test / expect / beforeAll / afterAll`
- **HTTP validation**: Elysia `t` namespace (NOT raw Zod) — `t.String({ minLength, maxLength, pattern })`
- **Env validation**: `@t3-oss/env-core` + Zod (coerced numbers, enums) in `src/env.ts` — `runtimeEnv: process.env`
- **TS config**: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `verbatimModuleSyntax: true`
- **Linter/formatter**: Biome 2.4 (space indent, 100 line width)
- **Logging**: Pino singleton (`src/lib/logger.ts`); structured `{ key, val }, "message"` format; never `console.log`
- **DB client**: postgres.js (singleton via `getSql()`); sets `pg_trgm.similarity_threshold = 0.3` deterministically
- **Cache**: in-process LRU; only first page (`offset === 0`); `?no_cache=1` bypasses (for benchmarks)
- **Test UI HTTP cache**: `apiFetch()` in `pages/assets/common.js` uses `cache: "no-store"` so the server-side LRU can serve `cache_status: "hit"` on repeated clicks (the server's `Cache-Control: public, max-age=30` is for CDNs, not the browser)
- **Singleton pattern**: lazy init in module var + `getXxx()` getter + `resetXxx()` for tests
- **Tier 1 btree prefix threshold is ≥1 char** (lowered from 3) — `"ab"`, `"xy"`, `"ab cd sydney"` all route to tier1, not tier2/tier4

## ANTI-PATTERNS (THIS PROJECT)
- **NEVER** cache paginated results (`offset > 0`) — only first page
- **NEVER** run `count(*)` on `address_search_mv` — use `pg_class.reltuples` (250ms+ vs O(1))
- **NEVER** use `ALTER MATERIALIZED VIEW ... DROP COLUMN` — Postgres doesn't support it; recreate MV
- **NEVER** mount `sql/005_prewarm.sql` in `docker-entrypoint-initdb.d` — runs after loader populates MV
- **NEVER** enable `jit` in `postgresql.conf` — adds 3-5ms overhead per query (more than execution for tier 0/1)
- **NEVER** create DB without `LC_COLLATE='C'` — `text_pattern_ops` indexes lose 10-20% performance
- **NEVER** use `*` for `CORS_ORIGINS` in production
- **NEVER** use `Bun.file().text()` in loader — use `.stream().getReader()` (memory)
- **NEVER** set `NODE_ENV=production` locally — enables 120/min rate limit that breaks benchmarks
- **NEVER** use `*` with `as any` / `@ts-ignore` / `@ts-expect-error` — fix the type
- **NEVER** mock the DB in tests — test the real query router
- **NEVER** include trigram queries in `/warmup` — each takes 100-500ms; "not on the hot path"
- **NEVER** use `ILIKE` — use `LIKE` with `text_pattern_ops` btree OR `%` trigram operator
- **NEVER** use `Bun.file().text()` in the loader (memory blowup — use stream+getReader)
- **NEVER** double-initialize `initSuggest()` in `pages/assets/suggest.js` (was a double-fire bug — use the `_suggestInitialized` guard)
- **NEVER** rely on the browser's HTTP cache for `/suggest` responses — the test UI opts out via `cache: "no-store"` in `apiFetch()` so the server-side LRU returns `cache_status: "hit"`
- **AVOID** mounting Postgres at `/data` (deprecated); use `/var/lib/postgresql` (Postgres 18+)

## UNIQUE STYLES
- **7-tier query router**: hardcoded decision tree, NOT cost-based — fastest viable index per query shape
- **MV display column** pre-assembled at refresh time (not at query time) — saves ~5ms per row
- **`search_text_expanded`** with abbreviation expansion via LATERAL JOIN against `address_abbrev_map` (not the function call) — 96M PL/pgSQL calls replaced with one batched query
- **State set includes `OT`** (Other Territories) — not in standard AU state lists
- **Tier 3 (GIN tsvector FTS) is defined but NEVER called from router** — vestigial; trigram tiers cover all cases
- **Tier 1c (Damerau-Levenshtein) was REMOVED** — only tier 0/0b/0c/1/2/4 remain (6 tiers + typo_corrected = 7 logical tiers)
- **Confidence normalization**: `NULL → 0.5`, `-1 → 0.3` (kept, not dropped), `0-6 → (c+1)/7`
- **PSV column indices are hardcoded** (0-based) in `load-worker.ts` — verified against actual G-NAF headers
- **Rolling timing stats** logged every 100 requests: `{ p50, p95, p99, avg, count }` with message `"suggest_stats"`
- **Readyz uses `pg_class.reltuples`** for O(1) row estimate, never `count(*)` on the 16M-row MV
- **Frontend is plain HTML/JS/CSS** in `pages/` — no Next.js, no build step, no bundler
- **ApiFetch with `cache: "no-store"`** — explicitly bypasses the browser HTTP cache so the server-side LRU can serve `cache_status: "hit"` (server sets `Cache-Control: public, max-age=30` for CDNs)
- **No `docker compose down -v` for quarterly refresh** — loader is idempotent (checks `pg_matviews.ispopulated` + `information_schema.tables`); just re-run `scripts/load.ts` against new PSV files

## COMMANDS
```bash
# Dev
bun run dev                    # watch mode
bun test                       # unit + integration tests (~476 tests)
bun run test:unit              # unit only (~417 tests, no DB)
bun run test:integration       # integration only (~59 tests, needs live API)
bun run lint                   # biome check src/
bun run format                 # biome format --write src/

# Production
docker compose up -d db                                          # start postgres
docker compose run --rm api bun run scripts/load.ts              # one-time data load (~9.5 min)
docker compose up -d api                                         # start API
curl -X POST http://localhost:8000/warmup                        # load indexes into cache
bun run benchmark/bench.ts                                       # verify p95 < 50ms

# Quarterly G-NAF refresh (4×/year) — loader is idempotent
export GNAF_DATA_DIR=/path/to/new/G-NAF/G-NAF\ MAY\ 2026/Standard
docker compose run --rm api bun run scripts/load.ts
docker compose restart api
```

## GOTCHAS
- `psql` output for `count(*)` on the 16M-row MV takes 250ms+ — use `pg_class.reltuples`
- `WITH NO DATA` MV: cannot SELECT from it; orchestrator checks `pg_matviews.ispopulated` instead
- First MV refresh MUST be non-concurrent (CONCURRENTLY errors on empty MV); loader uses `pg_matviews.ispopulated` to switch automatically
- `005_prewarm.sql` requires the MV to be populated — runs after loader, not in initdb
- 9 PSV workers each spawn their own postgres connection — loader uses ~9 extra connections beyond the 10-pool
- Benchmarks must use `?no_cache=1` to measure cold-cache latency (in-process LRU otherwise)
- Docker memory limit must be ≥14GB for `db` service; less → exit code 137
- `pg_trgm.similarity_threshold` default is 0.3 in Postgres 18 but set explicitly for cross-version safety
- `search_text` column cannot be dropped from MV (Postgres limitation) — DDL no longer defines it, so future recreations omit it
- `no_cache=1` is the test-UI tier-table source of truth; update it via `benchmark/verify-tiers.ts`
- `tier` field in `/suggest` response is the index the router chose — drives UI color coding
- **`pages/assets/suggest.js` had a double-fire bug**: `initSuggest()` was called twice (once from `DOMContentLoaded`, once from `tab-loaded`), adding duplicate event listeners. Fixed by `_suggestInitialized` guard at the top of `initSuggest()`.
- **Browser HTTP cache interferes with `cache_status: "hit"`** — without `cache: "no-store"` in `apiFetch()`, the browser serves the stale `Cache-Control: public, max-age=30` response and the server-side LRU never gets a chance to return `"hit"`.
- **MV is 3.3GB heap + 12GB indexes (~15GB total)**; pgdata volume ~27GB including WAL
- **Postgres `:00` doesn't have a 00:00 timestamp at startup** — `app.listen(env.PORT)` happens before the `onStart` hook; test UI polls `/readyz` instead
