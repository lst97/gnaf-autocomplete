# scripts

G-NAF PSV loader. Orchestrator + 9 parallel workers (one per state).

## OVERVIEW
Spawns 9 Bun processes in parallel to load 5 staging tables from G-NAF PSV
files via COPY FROM STDIN. Then TRUNCATEs, denormalizes, REFRESHes the
materialized view, and recreates indexes in parallel. ~9.5 min for full
16.0M row load on M5 Pro Mac (48GB host, 16GB Docker).

## STRUCTURE
| File | Purpose |
|------|---------|
| `load.ts` | Orchestrator: TRUNCATE staging → spawn 9 workers → denormalize → pre-filter → REFRESH MV → recreate indexes in parallel → prewarm |
| `load-worker.ts` | Worker: streams one state's 5 PSVs via COPY FROM STDIN (TSV format) |
| `build-fixture.ts` | Builds the test fixture from the live `address_search_mv` (1K edge-case addresses) |
| `update-gnaf.ts` | G-NAF update notifications |

## WHERE TO LOOK
- **Update for new G-NAF release**: update `GNAF_DATA_DIR` env var; verify PSV column indices in `load-worker.ts` match new headers
- **Change batch size**: edit `MAX_PARAMS_PER_QUERY` (default 11_000) — keeps param count under Postgres 65,534 limit AND keeps per-query memory low
- **Add a new staging table**: add entry to `STAGE_CONFIG` in `load-worker.ts` + add `DROP TABLE IF EXISTS` to `sql/005_staging.sql`
- **Change bulk INSERT strategy**: edit `flushBatch` in `load-worker.ts` — currently bulk INSERT in a transaction with `synchronous_commit = off` (Bun SQL does not support COPY FROM STDIN)

## CONVENTIONS
- **9 workers** via `Bun.spawn(["bun", "run", workerPath, "--state", state])` — one per AU state/territory
- **Streaming PSV reader**: `Bun.file().stream().getReader()` — NEVER `.text()` (memory)
- **Hardcoded column indices** (0-based) verified against actual G-NAF May 2026 headers
- **Adaptive batch sizing**: `batchSize = floor(65_000 / columns.length)` per table
- **COPY FROM STDIN** preferred (200-500K rows/sec) with TSV format: `DELIMITER E'\t', NULL '\N'`
- **Bulk INSERT fallback** (`ON CONFLICT DO NOTHING`) if COPY fails on a connection
- **Progress logging** every 5 seconds with rate calculation
- **First MV refresh** checks `pg_matviews.ispopulated` (not `SELECT FROM MV` — `WITH NO DATA` blocks reads)
- **Orchestrator** runs `pg_prewarm` after REFRESH (idempotent)
- **Schema skip**: orchestrator checks `tablesExist` before re-applying schema (idempotent) — supports quarterly refresh without `docker compose down -v`
- **Per-table column ordering**: staging column list in `STAGE_CONFIG` MUST match MV `INSERT` column order in extract function
- **NSW and QLD NOT split**: a previous experiment split these into 2 row-range chunks each, but concurrent COPY streams to the same table caused Bun runtime hangs (workers stuck at 0% CPU, no DB activity). Now single worker per state.

## ANTI-PATTERNS
- **NEVER** use `Bun.file().text()` — loads entire file into memory; use `.stream().getReader()`
- **NEVER** use `CONCURRENTLY` on first REFRESH — MV is empty (`WITH NO DATA`); orchestrator checks `ispopulated`
- **NEVER** hardcode PSV column positions without verifying against current G-NAF release headers
- **NEVER** skip `ON CONFLICT DO NOTHING` in bulk INSERT — duplicate PIDs cause loader failure
- **NEVER** call `getSql()` from the loader — workers create their own `postgres(dbUrl)` to avoid pool exhaustion
- **NEVER** add a worker without a corresponding entry in the `WORKERS` array (load.ts:62-72) — keep the array to all 9 states
- **NEVER** require `docker compose down -v` for a quarterly refresh — the loader is idempotent; just re-run with a new `GNAF_DATA_DIR`

## GOTCHAS
- Per-worker connection uses `postgres(dbUrl)` directly — does NOT go through app pool (loader uses ~9 extra connections beyond the 10-pool)
- `sql.end()` MUST be called in worker `finally` block to release the connection
- Escapes `\t\r\n\\` as space in COPY TSV (required by TSV format)
- Empty PSV fields → SQL NULL (especially for DATE / NUMERIC columns)
- Loader is DESTRUCTIVE: TRUNCATEs all 5 staging tables every run; data is not incremental
- Idempotent: `load.ts` checks `tablesExist` before re-applying schema — supports quarterly refresh without dropping the volume
- State list: `["ACT", "NSW", "NT", "OT", "QLD", "SA", "TAS", "VIC", "WA"]` — `OT` is "Other Territories"
- `STAGE_CONFIG` keys map to `staging_<key>` table names; each must have a corresponding `CREATE TABLE` in `sql/005_staging.sql`
- PSV file naming: `<STATE>_<SUFFIX>_psv.psv` (e.g., `NSW_ADDRESS_DETAIL_psv.psv`)
- Worker progress log format: `"<state>/<stage>: <rows> rows (<rate> rows/s)"`
- Phase breakdown (measured on M5 Pro Mac, 16M rows): 177s worker COPY (9 parallel) · 121s denormalization UPDATE · 143s MV REFRESH · 99s parallel index rebuild (6 connections) · 19s pre-filter + staging · 13s prewarm + cleanup
- 10 indexes on the MV: 1 UNIQUE (kept) + 2 GIN trigram tier4 (kept) + 7 dropped + recreated in 4 parallel batches
