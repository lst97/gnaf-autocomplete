-- G-NAF Address Autocomplete: pg_prewarm on container startup.
-- Prewarm the MV heap + the largest indexes into shared_buffers for consistent latency.
-- This is fast (a few seconds) and idempotent.

CREATE EXTENSION IF NOT EXISTS pg_prewarm;

SELECT pg_prewarm('address_search_mv');
SELECT pg_prewarm('idx_mv_tier2_trgm');
SELECT pg_prewarm('idx_mv_tier0_state_postcode');
SELECT pg_prewarm('idx_mv_tier0_state_locality');
SELECT pg_prewarm('idx_mv_tier0_number_first');
SELECT pg_prewarm('idx_mv_tier1_street_prefix');
SELECT pg_prewarm('idx_mv_postcode_prefix');
