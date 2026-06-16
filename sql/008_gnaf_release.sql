-- 008_gnaf_release.sql — G-NAF release version tracking
-- ============================================================
-- Singleton table tracking current loaded version + latest available
-- from data.gov.au. The CHECK (id = 1) constraint enforces the
-- single-row pattern.
--
-- Runs after 004_mv.sql and 005_prewarm.sql because it's independent
-- of the MV and indexes.
-- ============================================================

CREATE TABLE IF NOT EXISTS gnaf_release_info (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- The version currently loaded in PostgreSQL (mirrors GNAF_VERSION env var)
  current_version        text NOT NULL DEFAULT '',
  -- Download URL for the current version (recorded at load time)
  current_download_url   text NOT NULL DEFAULT '',
  -- Latest version found on data.gov.au (populated by scheduler)
  latest_available_version text NOT NULL DEFAULT '',
  -- Download URL for the latest available release
  latest_download_url    text NOT NULL DEFAULT '',
  -- Date the latest release was published on data.gov.au
  latest_release_date    date,
  -- Derived flag: true when latest_available_version > current_version
  update_available       boolean NOT NULL DEFAULT false,
  -- When we last successfully polled data.gov.au
  last_checked_at        timestamptz,
  -- When this row was last modified
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Insert the singleton row on first run; no-op if already exists
INSERT INTO gnaf_release_info (
  id, current_version, current_download_url
)
VALUES (
  1, 'MAY 2026', ''
)
ON CONFLICT (id) DO NOTHING;
