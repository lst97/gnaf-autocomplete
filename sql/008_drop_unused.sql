-- Drop unused index from address_search_mv.
--
-- idx_mv_confidence: standalone btree on (confidence_norm DESC) — no query
--   uses it; every query has a more specific WHERE that picks a different index.
--
-- NOTE: search_text column cannot be dropped here because Postgres does not
-- support ALTER MATERIALIZED VIEW ... DROP COLUMN. The column is no longer
-- selected by any query (the /address/:id endpoint was updated to stop reading
-- it), and the DDL source-of-truth (004_mv.sql) no longer defines it, so future
-- MV recreations (e.g. after a full reload) will omit it naturally.

BEGIN;

DROP INDEX IF EXISTS idx_mv_confidence;

COMMIT;
