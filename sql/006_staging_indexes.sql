-- G-NAF Address Autocomplete: Staging table indexes.
-- These speed up the REFRESH MATERIALIZED VIEW CONCURRENTLY by making JOINs fast.
-- Created AFTER the staging tables are populated, not before (slower COPY otherwise).

-- address_detail → street_locality JOIN
CREATE INDEX IF NOT EXISTS idx_staging_ad_street_pid
    ON staging_address_detail(street_locality_pid);

-- address_detail → locality JOIN
CREATE INDEX IF NOT EXISTS idx_staging_ad_locality_pid
    ON staging_address_detail(locality_pid);

-- locality → state JOIN
CREATE INDEX IF NOT EXISTS idx_staging_locality_state_pid
    ON staging_locality(state_pid);

-- address_geocode → address_detail (PK is already indexed; index not needed)
