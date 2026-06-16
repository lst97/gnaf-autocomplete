-- API keys table for domain-bound API key authentication.
-- Keys are generated via a Turnstile-protected form and bound to a domain.
-- The raw key is shown once at creation; only the SHA-256 hex digest is stored.

CREATE TABLE IF NOT EXISTS api_keys (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prefix           TEXT NOT NULL UNIQUE,               -- first 8 chars of raw key (for fast lookup)
  key_hash         TEXT NOT NULL UNIQUE,               -- SHA-256 hex digest of the full key
  domain           TEXT NOT NULL,                      -- registered domain (e.g., "myapp.com")
  description      TEXT NOT NULL DEFAULT '',            -- optional label for the key owner
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'revoked')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at       TIMESTAMPTZ,
  last_used_at     TIMESTAMPTZ,
  request_count    BIGINT NOT NULL DEFAULT 0,

  -- Per-key rate limiting (fixed-hour window)
  rl_window_start  TIMESTAMPTZ,
  rl_window_count  INT NOT NULL DEFAULT 0
);

-- Fast prefix lookup without scanning all SHA-256 hashes
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys (prefix);
