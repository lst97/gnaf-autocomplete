-- Track when each key was last domain-verified.
-- The current time is recorded each time the DNS TXT record check
-- succeeds during key activation (POST /api/keys/:prefix/verify).
-- NULL means the key has never been verified (pending or pre-migration).

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;
