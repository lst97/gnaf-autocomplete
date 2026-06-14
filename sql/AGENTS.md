# sql

PostgreSQL schema, materialized view, indexes, helpers. 8 numbered files, applied in order.

## OVERVIEW
8 files run by `docker-entrypoint-initdb.d` on first DB init, plus 1 file
(`005_prewarm.sql`) run after the loader populates the MV. Defines staging
tables, the single materialized view, and all 8 indexes for the 7-tier query router.

## STRUCTURE
| File | Runs | Purpose |
|------|------|---------|
| `001_extensions.sql` | init | `pg_trgm`, `unaccent`, `fuzzystrmatch` (latter for `damerau_levenshtein_distance()`) |
| `002_staging.sql` | init | 5 staging tables (state, locality, street_locality, address_detail, address_geocode) |
| `003_staging_indexes.sql` | init (after COPY) | 3 indexes on staging — created AFTER load to avoid slowing COPY |
| `004_mv.sql` | init | MV definition + 8 indexes (4 btree covering, 2 GIN trigram, 1 GIN tsvector, 1 unique) |
| `005_prewarm.sql` | AFTER loader | `pg_prewarm` on MV + 6 indexes (NOT `idx_mv_tier3_fts`) |
| `006_abbrev_map.sql` | init | `address_abbrev_map` table: street types, directionals, states, flat types |
| `007_expand_fn.sql` | init | `expand_address_abbrevs()` plpgsql IMMUTABLE function |
| `008_drop_unused.sql` | init | Drops deprecated `idx_mv_confidence` |

## WHERE TO LOOK
- **Add new index**: edit `004_mv.sql` (source of truth) + `005_prewarm.sql` (for cold-start perf)
- **Change display format**: edit the nested `COALESCE/CASE` in MV's `display` column (rebuild MV via loader)
- **Add new abbreviation**: INSERT into `address_abbrev_map` (use `ON CONFLICT DO NOTHING`)
- **Change confidence normalization**: edit the `CASE WHEN` in MV (lines 98-102 of `004_mv.sql`)

## CONVENTIONS
- **MV refresh**: first refresh MUST be non-concurrent (MV has `WITH NO DATA`); subsequent use `CONCURRENTLY` (orchestrator checks `pg_matviews.ispopulated`)
- **Index naming**: `idx_mv_<tier>_<columns>` (e.g., `idx_mv_tier0_state_postcode`)
- **Covering INCLUDE**: every btree on the MV includes `(address_detail_pid, display, lat, lon, confidence_norm)` for index-only scans
- **`text_pattern_ops`** mandatory on `locality_lc`, `street_lc`, `postcode` btree columns
- **Staging indexes** are created in `003_staging_indexes.sql` AFTER the COPY load — creating before slows bulk inserts
- **`search_text_expanded`** is the ONLY search text column (raw `search_text` removed in v2.2)
- **MV filter**: `WHERE ad.date_retired IS NULL AND (ad.alias_principal IS NULL OR ad.alias_principal != 'A')`
- **Loader PSV column indices** (0-based) hardcoded in `scripts/load-worker.ts:26-52` — must match these tables

## ANTI-PATTERNS
- **NEVER** add a column to MV without rebuilding (no `ALTER MATERIALIZED VIEW ... DROP COLUMN` support)
- **NEVER** mount `005_prewarm.sql` in `docker-compose.yml` init — runs after loader populates MV
- **NEVER** create the database without `LC_COLLATE='C'` — `text_pattern_ops` indexes lose 10-20% performance
- **NEVER** use `count(*)` on the MV in production code — use `pg_class.reltuples` (see `src/api/health.ts`)
- **NEVER** drop the unique index `idx_mv_address_detail_pid` — required for `CONCURRENTLY` refresh
- **NEVER** change the MV without re-running the loader — DDL change requires full REFRESH

## GOTCHAS
- Confidence normalization: `NULL → 0.5`, `-1 → 0.3` (kept, not dropped), `0-6 → (c+1)/7`
- `search_text` column cannot be dropped from MV — Postgres limitation; DDL source no longer defines it, so future recreations omit it
- The MV is ~6GB on disk; total index space ~10-12GB
- `wal_level = replica` required in `postgresql.conf` for `CONCURRENTLY` refresh
- `idx_mv_confidence` was removed via `008_drop_unused.sql` — no query uses it
- Tier 3 (`idx_mv_tier3_fts`) is intentionally NOT prewarmed — large GIN tsvector, used only by vestigial FTS tier
- Staging tables are ephemeral — TRUNCATEd on every loader run; never backed up
- `expand_address_abbrevs` is `IMMUTABLE` — Postgres can use it in index expressions
- `confidence_norm` in MV is the only column the planner can use for "trust" ranking; the tier SQL multiplies similarity by `(1 + ln(confidence_norm + 1))`
