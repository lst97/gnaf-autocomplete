-- G-NAF Address Autocomplete: Raw staging tables.
-- These are populated by COPY from the G-NAF PSV files via scripts/load-worker.ts.
-- The materialized view (004_mv.sql) JOINs across all 5 to build the search index.
-- API queries NEVER touch these tables.

DROP TABLE IF EXISTS staging_address_detail CASCADE;
DROP TABLE IF EXISTS staging_address_geocode CASCADE;
DROP TABLE IF EXISTS staging_street_locality CASCADE;
DROP TABLE IF EXISTS staging_locality CASCADE;
DROP TABLE IF EXISTS staging_state CASCADE;

-- STATE: 9 rows (ACT, NSW, NT, OT, QLD, SA, TAS, VIC, WA)
CREATE UNLOGGED TABLE staging_state (
    state_pid           VARCHAR(15) NOT NULL PRIMARY KEY,
    state_name          VARCHAR(50) NOT NULL,
    state_abbreviation  VARCHAR(3) NOT NULL
);

-- LOCALITY: ~16K rows (suburbs, towns, localities)
CREATE UNLOGGED TABLE staging_locality (
    locality_pid        VARCHAR(15) NOT NULL PRIMARY KEY,
    locality_name       VARCHAR(100) NOT NULL,
    primary_postcode    VARCHAR(4),
    state_pid           VARCHAR(15) NOT NULL REFERENCES staging_state(state_pid)
);

-- STREET_LOCALITY: ~700K rows (street names per locality)
CREATE UNLOGGED TABLE staging_street_locality (
    street_locality_pid VARCHAR(15) NOT NULL PRIMARY KEY,
    street_name         VARCHAR(100) NOT NULL,
    street_type_code    VARCHAR(15),
    street_suffix_code  VARCHAR(15),
    locality_pid        VARCHAR(15) NOT NULL REFERENCES staging_locality(locality_pid)
);

-- ADDRESS_DETAIL: 16.9M rows (the core address table, one row per address)
-- Denormalized columns (street_name_dn, locality_name_dn, etc.) are populated
-- by the orchestrator's UPDATE after all workers complete. They let the MV
-- avoid 4-table JOINs during REFRESH (saves ~96.5s).
CREATE UNLOGGED TABLE staging_address_detail (
    address_detail_pid      VARCHAR(15) NOT NULL PRIMARY KEY,
    building_name           VARCHAR(200),
    lot_number_prefix       VARCHAR(2),
    lot_number              VARCHAR(5),
    lot_number_suffix       VARCHAR(2),
    flat_type_code          VARCHAR(7),
    flat_number_prefix      VARCHAR(2),
    flat_number             NUMERIC(5),
    flat_number_suffix      VARCHAR(2),
    level_type_code         VARCHAR(4),
    level_number_prefix     VARCHAR(2),
    level_number            NUMERIC(3),
    level_number_suffix     VARCHAR(2),
    number_first_prefix     VARCHAR(3),
    number_first            NUMERIC(6),
    number_first_suffix     VARCHAR(2),
    number_last_prefix      VARCHAR(3),
    number_last             NUMERIC(6),
    number_last_suffix      VARCHAR(2),
    street_locality_pid     VARCHAR(15) REFERENCES staging_street_locality(street_locality_pid),
    locality_pid            VARCHAR(15) NOT NULL REFERENCES staging_locality(locality_pid),
    alias_principal         CHAR(1),
    postcode                VARCHAR(4),
    confidence              NUMERIC(1),
    date_retired            DATE,
    street_name_dn          VARCHAR(100),
    street_type_code_dn     VARCHAR(15),
    street_suffix_code_dn   VARCHAR(15),
    locality_name_dn        VARCHAR(100),
    state_abbreviation_dn   VARCHAR(3)
);

-- ADDRESS_DEFAULT_GEOCODE: 16.9M rows (1:1 with ADDRESS_DETAIL, lat/lon)
CREATE UNLOGGED TABLE staging_address_geocode (
    address_detail_pid  VARCHAR(15) NOT NULL PRIMARY KEY REFERENCES staging_address_detail(address_detail_pid),
    longitude           NUMERIC(11, 8),
    latitude            NUMERIC(10, 8)
);
