-- G-NAF Address Autocomplete: PostgreSQL extensions
-- Runs before any other SQL on first container init.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
