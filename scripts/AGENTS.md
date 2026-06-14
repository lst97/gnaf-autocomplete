# scripts

G-NAF PSV loader. Orchestrator + 9 parallel workers (one per state).

## OVERVIEW
Spawns 9 Bun processes in parallel to load 5 staging tables from G-NAF PSV
files via COPY FROM STDIN. Then REFRESHes materialized view and prewarms
indexes. ~10 min for full 16.9M row load on M1/M2 Mac.

## STRUCTURE
| File | Purpose |
|------|---------|
| `load.ts` | Orchestrator: TRUNCATE staging → spawn N workers (default 1) → REFRESH MV → prewarm |
| `load-worker.ts` | Worker: streams one state's 5 PSVs, COPYs in adaptive-sized batches |

## WHERE TO LOOK
- **Update for new G-NAF release**: update `GNAF_DATA_DIR` env var; verify PSV column indices in `load-worker.ts:26-52` match new headers
- **Change batch size**: edit `MAX_PARAMS_PER_QUERY` (default 11_000) — keeps param count under Postgres 65,534 limit AND keeps per-query memory low
- **Add a new staging table**: add entry to `STAGE_CONFIG` (load-worker.ts:58-143) + add `DROP TABLE IF EXISTS` to `sql/002_staging.sql`
- **Change bulk INSERT strategy**: edit `flushBatch` in `load-worker.ts:246-268` — currently bulk INSERT in a transaction with `synchronous_commit = off` (Bun SQL does not support COPY FROM STDIN)

## CONVENTIONS
- **N workers** (default 1) via `Bun.spawn(["bun", "run", workerPath, "--state", state])` — default is sequential because parallel workers OOM-kill on memory-constrained hosts; increase STATES array to 2-3 with ≥20GB free RAM, or 9 inside the docker container
- **Streaming PSV reader**: `Bun.file().stream().getReader()` — NEVER `.text()` (memory)
- **Hardcoded column indices** (0-based) verified against actual G-NAF May 2026 headers
- **Adaptive batch sizing**: `batchSize = floor(65_000 / columns.length)` per table
- **COPY FROM STDIN** preferred (200-500K rows/sec) with TSV format: `DELIMITER E'\t', NULL '\N'`
- **Bulk INSERT fallback** (`ON CONFLICT DO NOTHING`) if COPY fails on a connection
- **Progress logging** every 5 seconds with rate calculation
- **First MV refresh** checks `pg_matviews.ispopulated` (not `SELECT FROM MV` — `WITH NO DATA` blocks reads)
- **Orchestrator** runs `pg_prewarm` after REFRESH (idempotent)
- **Schema skip**: orchestrator checks `tablesExist` before re-applying schema (idempotent)
- **Per-table column ordering**: staging column list in `STAGE_CONFIG` MUST match MV `INSERT` column order in extract function

## ANTI-PATTERNS
- **NEVER** use `Bun.file().text()` — loads entire file into memory; use `.stream().getReader()`
- **NEVER** use `CONCURRENTLY` on first REFRESH — MV is empty (`WITH NO DATA`); orchestrator checks `ispopulated`
- **NEVER** hardcode PSV column positions without verifying against current G-NAF release headers
- **NEVER** skip `ON CONFLICT DO NOTHING` in bulk INSERT — duplicate PIDs cause loader failure
- **NEVER** call `getSql()` from the loader — workers create their own `postgres(dbUrl)` to avoid pool exhaustion
- **NEVER** add a worker without a corresponding entry in the `STATES` array (load.ts:30) — keep the array to big states only; on memory-constrained hosts, load one state per invocation

## GOTCHAS
- Per-worker connection uses `postgres(dbUrl)` directly — does NOT go through app pool (loader uses ~9 extra connections beyond the 10-pool)
- `sql.end()` MUST be called in worker `finally` block to release the connection
- Escapes `\t\r\n\\` as space in COPY TSV (required by TSV format)
- Empty PSV fields → SQL NULL (especially for DATE / NUMERIC columns)
- Loader is DESTRUCTIVE: TRUNCATEs all 5 staging tables every run; data is not incremental
- `cross-confirmed` by `load.ts` checking `tablesExist` before re-applying schema
- State list: `["ACT", "NSW", "NT", "OT", "QLD", "SA", "TAS", "VIC", "WA"]` — `OT` is "Other Territories"
- `STAGE_CONFIG` keys map to `staging_<key>` table names; each must have a corresponding `CREATE TABLE` in `sql/002_staging.sql`
- PSV file naming: `<STATE>_<SUFFIX>_psv.psv` (e.g., `NSW_ADDRESS_DETAIL_psv.psv`)
- Multi-statement SQL files are split by `;` and executed individually (load.ts:57-63) — `sql.unsafe()` hangs on multi-statement files
- Worker progress log format: `"<state>/<stage>: <rows> rows (<rate> rows/s)"`
