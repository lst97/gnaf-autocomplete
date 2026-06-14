-- Domain ownership verification for API keys.
-- Keys are created with status='pending' and must be verified via DNS TXT record.
-- The verification_token must appear in the domain's TXT records as "gnaf-verify=<token>".

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS verification_token TEXT UNIQUE;

-- Update the status check constraint to include 'pending'
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_status_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_status_check
  CHECK (status IN ('active', 'pending', 'revoked'));

-- New keys default to pending
ALTER TABLE api_keys ALTER COLUMN status SET DEFAULT 'pending';

-- Allow querying by verification_token quickly
CREATE INDEX IF NOT EXISTS idx_api_keys_verification_token ON api_keys (verification_token);
