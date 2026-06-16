# sql

PostgreSQL schema, materialized view, indexes, helpers, and auth tables. 13 files, applied in order on first DB init.

## OVERVIEW
13 files run by `docker-entrypoint-initdb.d` on first DB init, plus 1 file
(`005_prewarm.sql`) run after the loader populates the MV. Defines the 5
staging tables, the single materialized view with 10 indexes, abbreviation
map, API key/auth tables, and G-NAF release tracking.

## STRUCTURE
| File | Runs | Purpose |
|------|------|---------|
| `001_extensions.sql` | init | `pg_trgm`, `unaccent`, `fuzzystrmatch` (latter for `damerau_levenshtein_distance()`) |
| `003b_abbrev_map.sql` | init | `address_abbrev_map` table: street types, directionals, states, flat types |
| `003c_expand_fn.sql` | init | `expand_address_abbrevs()` plpgsql IMMUTABLE function (vestigial; MV uses LATERAL JOIN) |
| `005_staging.sql` | init | 5 staging tables (state, locality, street_locality, address_detail, address_geocode) |
| `006_staging_indexes.sql` | init (after COPY) | 3 indexes on staging — created AFTER load to avoid slowing COPY |
| `007_mv.sql` | init | MV definition + 10 indexes (4 btree covering, 2 GIN trigram street+locality, 1 GIN trigram search_text, 1 GIN tsvector tier3, 1 btree postcode prefix, 1 UNIQUE) |
| `005_prewarm.sql` | AFTER loader | `pg_prewarm` on MV + 6 indexes (NOT `idx_mv_tier3_fts`) |
| `008_api_keys.sql` | init | `api_keys` table for API key auth + domains |
| `008_drop_unused.sql` | init | Drops deprecated `idx_mv_confidence` |
| `008_gnaf_release.sql` | init | Tracks which G-NAF release is loaded |
| `009_domain_verify.sql` | init | Domain verification (DNS TXT records) tables |
| `010_last_verified.sql` | init | Last verification timestamp tracking |
| `011_gnaf_roles.sql` | init | Postgres roles / permissions |
| `012_api_key_expiry.sql` | init | API key expiry columns (90-day sliding window) |

## WHERE TO LOOK
- **Add new index**: edit `007_mv.sql` (source of truth) + `005_prewarm.sql` (for cold-start perf)
- **Change display format**: edit the nested `COALESCE/CASE` in MV's `display` column (rebuild MV via loader)
- **Add new abbreviation**: INSERT into `address_abbrev_map` (use `ON CONFLICT DO NOTHING`)
- **Change confidence normalization**: edit the `CASE WHEN` in MV (`007_mv.sql` lines 95-99)

## CONVENTIONS
- **MV refresh**: first refresh MUST be non-concurrent (MV has `WITH NO DATA`); subsequent use `CONCURRENTLY` (orchestrator checks `pg_matviews.ispopulated`)
- **Index naming**: `idx_mv_<tier>_<columns>` (e.g., `idx_mv_tier0_state_postcode`)
- **Covering INCLUDE**: every btree on the MV includes `(address_detail_pid, display, lat, lon, confidence_norm)` for index-only scans
- **`text_pattern_ops`** mandatory on `locality_lc`, `street_lc`, `postcode` btree columns
- **Staging indexes** are created in `006_staging_indexes.sql` AFTER the COPY load — creating before slows bulk inserts
- **`search_text_expanded`** is the ONLY search text column (raw `search_text` removed in v2.2)
- **MV filter** (date_retired/alias) is now a pre-REFRESH DELETE in `scripts/load.ts`, not a WHERE clause in the MV
- **Loader PSV column indices** (0-based) hardcoded in `scripts/load-worker.ts` — must match these tables

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
- **MV is 3.3GB heap + 12GB indexes (~15GB total)**
- `wal_level = replica` required in `postgresql.conf` for `CONCURRENTLY` refresh
- `idx_mv_confidence` was removed via `008_drop_unused.sql` — no query uses it
- Tier 3 (`idx_mv_tier3_fts`) is intentionally NOT prewarmed — large GIN tsvector, used only by vestigial FTS tier
- Staging tables are ephemeral — TRUNCATEd on every loader run; never backed up
- `expand_address_abbrevs` is `IMMUTABLE` — Postgres can use it in index expressions (but the MV uses LATERAL JOIN instead, for performance)
- `confidence_norm` in MV is the only column the planner can use for "trust" ranking; the tier SQL multiplies similarity by `(1 + ln(confidence_norm + 1))`
- 10 MV indexes: 1 UNIQUE (`idx_mv_address_detail_pid`) + 4 btree covering (tier0 state+postcode, tier0 state+number, tier0 state+locality, tier1 street+prefix) + 1 btree prefix (postcode) + 2 GIN trigram street/locality (tier4) + 1 GIN trigram search_text (tier2) + 1 GIN tsvector (tier3 vestigial)
