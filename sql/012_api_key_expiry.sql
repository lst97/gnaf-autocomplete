-- API key expiry (90-day sliding window).
-- Keys expire 90 days after their last use. Actively-used keys are
-- auto-extended in the application layer (src/lib/touch-key.ts).
-- Column is NOT NULL with a default so new keys always get an expiry.

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '90 days');
