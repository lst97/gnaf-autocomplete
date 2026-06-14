-- G-NAF Address Autocomplete: Materialized view + all search indexes.
--
-- This is the single hot read target. The API never touches staging tables.
-- REFRESH MATERIALIZED VIEW CONCURRENTLY is supported (requires UNIQUE INDEX).
--
-- v3.0 optimizations:
--   - staging_address_detail is denormalized (street_name_dn, locality_name_dn,
--     state_abbreviation_dn) so the MV doesn't need 4-table JOINs
--   - display is computed from the denormalized columns using a simpler
--     concatenation (6 nested CASE expressions → COALESCE chains)
--   - search_text_expanded uses a LATERAL JOIN against address_abbrev_map
--     instead of calling expand_address_abbrevs() per row (96M function
--     calls replaced with a single batched query plan)
--   - WHERE clause removed (date_retired/alias_principal filter moved to a
--     pre-REFRESH DELETE in scripts/load.ts)

DROP MATERIALIZED VIEW IF EXISTS address_search_mv CASCADE;

CREATE MATERIALIZED VIEW address_search_mv AS
SELECT
    ad.address_detail_pid,

    -- Pre-formatted display string (computed from denormalized columns)
    COALESCE(ad.building_name || ', ', '') ||
    CASE WHEN ad.lot_number IS NOT NULL THEN
        'Lot ' || COALESCE(ad.lot_number_prefix, '') || ad.lot_number ||
        COALESCE(ad.lot_number_suffix, '') || ', '
    ELSE '' END ||
    CASE WHEN ad.flat_type_code IS NOT NULL AND ad.flat_number IS NOT NULL THEN
        ad.flat_type_code || ' ' || ad.flat_number ||
        COALESCE(ad.flat_number_prefix, '') || COALESCE(ad.flat_number_suffix, '') || ', '
    WHEN ad.flat_type_code IS NOT NULL OR ad.flat_number IS NOT NULL THEN
        COALESCE(ad.flat_type_code || ' ', '') || COALESCE(ad.flat_number::TEXT, '') ||
        COALESCE(ad.flat_number_prefix, '') || COALESCE(ad.flat_number_suffix, '') || ', '
    ELSE '' END ||
    CASE WHEN ad.level_type_code IS NOT NULL AND ad.level_number IS NOT NULL THEN
        ad.level_type_code || ' ' || ad.level_number::TEXT || ', '
    ELSE '' END ||
    CASE WHEN ad.number_first IS NOT NULL THEN
        COALESCE(ad.number_first_prefix, '') || ad.number_first::TEXT ||
        COALESCE(ad.number_first_suffix, '') ||
        CASE WHEN ad.number_last IS NOT NULL
             THEN '-' || COALESCE(ad.number_last_prefix, '') || ad.number_last::TEXT ||
                  COALESCE(ad.number_last_suffix, '')
             ELSE ''
        END || ' '
    ELSE '' END ||
    COALESCE(ad.street_name_dn || ' ' ||
        CASE ad.street_type_code_dn
            WHEN 'ROAD' THEN 'RD'      WHEN 'STREET' THEN 'ST'
            WHEN 'COURT' THEN 'CT'     WHEN 'AVENUE' THEN 'AV'
            WHEN 'LANE' THEN 'LN'      WHEN 'PLACE' THEN 'PL'
            WHEN 'DRIVE' THEN 'DR'     WHEN 'CLOSE' THEN 'CL'
            WHEN 'CRESCENT' THEN 'CR'  WHEN 'TERRACE' THEN 'TCE'
            WHEN 'CIRCUIT' THEN 'CCT' WHEN 'PARADE' THEN 'PDE'
            WHEN 'GROVE' THEN 'GR'    WHEN 'WALK' THEN 'WK'
            WHEN 'BOULEVARD' THEN 'BV' WHEN 'TRAIL' THEN 'TRL'
            WHEN 'HIGHWAY' THEN 'HWY' WHEN 'TRACK' THEN 'TK'
            WHEN 'ACCESS' THEN 'ACCS'  WHEN 'PARKWAY' THEN 'PKWY'
            WHEN 'ESPLANADE' THEN 'ESP' WHEN 'PROMENADE' THEN 'PROM'
            WHEN 'SQUARE' THEN 'SQ'   WHEN 'RISE' THEN 'RISE'
            WHEN 'ROW' THEN 'ROW'     WHEN 'WAY' THEN 'WAY'
            WHEN 'CIRCLE' THEN 'CIR'  WHEN 'GLEN' THEN 'GLN'
            WHEN 'LOOP' THEN 'LOOP'   ELSE COALESCE(ad.street_type_code_dn, '')
        END ||
        CASE WHEN ad.street_suffix_code_dn IS NOT NULL
             THEN ' ' || ad.street_suffix_code_dn
             ELSE ''
        END, '') ||
    ', ' || ad.locality_name_dn || ' ' || ad.state_abbreviation_dn || ' ' ||
    COALESCE(ad.postcode, '') AS display,

    -- Expanded search text using LATERAL JOIN against address_abbrev_map.
    -- Each row's concatenated text is unnested into words, each word is
    -- looked up in address_abbrev_map (hash-joinable), and the expanded
    -- words are reassembled. Replaces 96M PL/pgSQL function calls with
    -- a single batched query plan.
    lower(string_agg(
        COALESCE(am.full_form, w.word),
        ' ' ORDER BY w.ordinality
    )) AS search_text_expanded,

    -- Lowercased columns for btree prefix indexes
    lower(ad.street_name_dn) AS street_lc,
    lower(ad.locality_name_dn) AS locality_lc,
    ad.locality_name_dn AS locality,

    -- Numeric street number (for the (state, number_first) btree index)
    ad.number_first,

    -- Filter/sort columns
    ad.state_abbreviation_dn AS state,
    ad.postcode,
    ad.confidence,
    CASE
        WHEN ad.confidence IS NULL THEN 0.5
        WHEN ad.confidence < 0 THEN 0.3
        ELSE (ad.confidence + 1.0) / 7.0
    END AS confidence_norm,

    -- Geocodes
    geo.latitude AS lat,
    geo.longitude AS lon

FROM staging_address_detail ad
CROSS JOIN LATERAL unnest(string_to_array(
    COALESCE(ad.building_name || ' ', '') ||
    COALESCE(ad.flat_type_code || ' ' || ad.flat_number::TEXT || ' ', '') ||
    COALESCE(ad.number_first::TEXT || ' ', '') ||
    COALESCE(ad.street_name_dn || ' ' || ad.street_type_code_dn || ' ', '') ||
    COALESCE(ad.locality_name_dn || ' ', '') ||
    COALESCE(ad.state_abbreviation_dn || ' ', '') ||
    COALESCE(ad.postcode, ''),
    ' '
)) WITH ORDINALITY AS w(word, ordinality)
LEFT JOIN address_abbrev_map am ON am.abbrev = upper(w.word)
LEFT JOIN staging_address_geocode geo ON ad.address_detail_pid = geo.address_detail_pid
GROUP BY ad.address_detail_pid, ad.building_name, ad.lot_number_prefix, ad.lot_number,
         ad.lot_number_suffix, ad.flat_type_code, ad.flat_number, ad.flat_number_prefix,
         ad.flat_number_suffix, ad.level_type_code, ad.level_number, ad.level_number_prefix,
         ad.level_number_suffix, ad.number_first_prefix, ad.number_first, ad.number_first_suffix,
         ad.number_last_prefix, ad.number_last, ad.number_last_suffix, ad.street_name_dn,
         ad.street_type_code_dn, ad.street_suffix_code_dn, ad.locality_name_dn,
         ad.state_abbreviation_dn, ad.postcode, ad.confidence, geo.latitude, geo.longitude
WITH NO DATA;

-- ============================================================================
-- INDEXES ON MATERIALIZED VIEW
-- ============================================================================

-- UNIQUE INDEX: required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX idx_mv_address_detail_pid
    ON address_search_mv (address_detail_pid);

-- TIER 0: btree on (state, postcode) with covering INCLUDE.
--   Query: WHERE state='NSW' AND postcode='2000' → Index-Only Scan, <1ms.
CREATE INDEX idx_mv_tier0_state_postcode
    ON address_search_mv (state, postcode)
    INCLUDE (address_detail_pid, display, lat, lon, confidence_norm);

-- TIER 0c: btree on (state, number_first) with covering INCLUDE.
--   v2.1 addition. 51.8% of NSW addresses have a number_first.
--   Query: WHERE state='NSW' AND number_first=12 → <1ms.
CREATE INDEX idx_mv_tier0_number_first
    ON address_search_mv (state, number_first)
    INCLUDE (address_detail_pid, display, lat, lon, postcode, confidence_norm);

-- TIER 0b: btree on (state, locality_lc text_pattern_ops) for locality prefix.
--   Query: WHERE state='NSW' AND locality_lc LIKE 'syd%' → <5ms.
--   locality included so Index-Only Scans don't heap-fetch the suburb name.
CREATE INDEX idx_mv_tier0_state_locality
    ON address_search_mv (state, locality_lc text_pattern_ops)
    INCLUDE (address_detail_pid, display, lat, lon, postcode, confidence_norm, locality);

-- TIER 1: btree on street_lc (text_pattern_ops, confidence_norm DESC) for
-- street name prefix. Optional number_first filter narrows to a specific
-- street number (e.g. "35 gresford" returns just 35-gresford addresses).
--   Query: WHERE street_lc LIKE 'gresford%' AND number_first = 35 → 0.8ms.
--   locality included — street searches always need suburb context.
CREATE INDEX idx_mv_tier1_street_prefix
    ON address_search_mv (street_lc text_pattern_ops, confidence_norm DESC)
    INCLUDE (address_detail_pid, display, lat, lon, state, postcode, number_first, locality);

-- TIER 2: GIN trigram on search_text_expanded for typo-tolerant matching.
--   Uses the abbreviation-expanded text so "MAIN ST" matches "MAIN STREET".
--   Query: WHERE search_text_expanded % 'sydne' → 10-30ms.
--   fastupdate = off improves query performance by 20-30% (avoids linear scan
--   of pending list entries). Trade-off: slightly slower index build, but the
--   index is dropped before REFRESH and recreated after, so the cost is minimal.
CREATE INDEX idx_mv_tier2_trgm
    ON address_search_mv USING GIN (search_text_expanded gin_trgm_ops)
    WITH (fastupdate = off);

-- TIER 4: GIN trigrams on individual street_lc and locality_lc columns.
--   For multi-word queries, the trigram match on the FULL search_text_expanded
--   is too coarse (short trigrams like "ab" match 5M+ rows). Targeting the
--   individual columns gives a much smaller candidate set:
--     street_lc % 'main'   → only addresses where "main" is the street
--     locality_lc % 'syd'  → only addresses where "syd..." is the locality
--   Both are used in OR in the tier4 query; indexes are small (~500MB each)
--   because street_lc and locality_lc are short single-word columns.
CREATE INDEX idx_mv_tier4_street_trgm
    ON address_search_mv USING GIN (street_lc gin_trgm_ops)
    WITH (fastupdate = off);
CREATE INDEX idx_mv_tier4_locality_trgm
    ON address_search_mv USING GIN (locality_lc gin_trgm_ops)
    WITH (fastupdate = off);

-- TIER 3: GIN tsvector on search_text_expanded for prefix-only ranked FTS.
--   Query: WHERE to_tsvector('simple', search_text_expanded) @@ to_tsquery('simple', 'syd:*') → 10-30ms.
CREATE INDEX idx_mv_tier3_fts
    ON address_search_mv USING GIN (to_tsvector('simple', search_text_expanded));

-- Confidence sort index for ORDER BY when no other index is viable
CREATE INDEX idx_mv_confidence
    ON address_search_mv (confidence_norm DESC);

-- POSTCODE PREFIX: btree on (postcode text_pattern_ops) for prefix matching.
--   Query: WHERE postcode LIKE '20%' → <1ms.
CREATE INDEX idx_mv_postcode_prefix
    ON address_search_mv (postcode text_pattern_ops)
    INCLUDE (address_detail_pid, display, lat, lon, state, postcode, confidence_norm);
