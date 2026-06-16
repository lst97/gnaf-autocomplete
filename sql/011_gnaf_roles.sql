-- G-NAF least-privilege roles.
-- Creates two roles for the API: gnaf_readonly (SELECT on MV + api_keys + pg_class)
-- and gnaf_readwrite (same + INSERT/UPDATE/DELETE on api_keys).
-- Idempotent via DO blocks.
-- DEPENDS ON: 007_mv.sql (address_search_mv) and 008_api_keys.sql (api_keys).
-- Mount AFTER both in docker-entrypoint-initdb.d or GRANTs fail at init.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gnaf_readonly') THEN
    CREATE ROLE gnaf_readonly NOLOGIN;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gnaf_readwrite') THEN
    CREATE ROLE gnaf_readwrite NOLOGIN;
  END IF;
END
$$;

-- Grant schema USAGE (required for any table access)
GRANT USAGE ON SCHEMA public TO gnaf_readonly;
GRANT USAGE ON SCHEMA pg_catalog TO gnaf_readwrite;

-- Read-only: the hot path tables
GRANT SELECT ON address_search_mv TO gnaf_readonly;
GRANT SELECT ON api_keys TO gnaf_readonly;
-- pg_class is needed by /readyz for the O(1) row count
GRANT SELECT ON pg_class TO gnaf_readonly;
-- pg_matviews is needed by /readyz for the ispopulated check
GRANT SELECT ON pg_matviews TO gnaf_readonly;

-- Read-write inherits readonly, plus write on api_keys
GRANT gnaf_readonly TO gnaf_readwrite;
GRANT INSERT, UPDATE, DELETE ON api_keys TO gnaf_readwrite;
