import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url().default("postgresql://postgres:postgres@localhost:5433/gnaf"),
  GNAF_DATA_DIR: z
    .string()
    .default("")
    .describe("Path to G-NAF PSV files directory (only needed for the loader)."),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  CORS_ORIGINS: z.string().default("*"),

  // Public URL for same-origin auth bypass (e.g. https://api.example.com)
  // Requests with Origin/Referer matching this URL skip domain mismatch checks.
  PUBLIC_URL: z.string().default(""),

  // Suggest result cache
  SUGGEST_CACHE_MAX: z.coerce.number().int().min(1).max(100000).default(1000),
  SUGGEST_CACHE_TTL_MS: z.coerce.number().int().min(1000).max(3600000).default(30000),

  // Cloudflare Turnstile
  TURNSTILE_SECRET_KEY: z.string().default(""),
  TURNSTILE_SITE_KEY: z.string().default(""),

  // Per-key rate limiting
  API_KEY_RATE_LIMIT: z.coerce.number().int().min(1).max(1000000).default(5000),
  API_KEY_RATE_WINDOW_MS: z.coerce.number().int().min(60000).max(86400000).default(3600000),

  // Key generation rate limit (per IP)
  KEYGEN_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(10),
  KEYGEN_RATE_WINDOW_MS: z.coerce.number().int().min(60000).max(86400000).default(3600000),

  // Max active + pending keys per domain
  MAX_KEYS_PER_DOMAIN: z.coerce.number().int().min(1).max(100).default(5),

  // Space-separated list of TLDs blocked from key registration
  DOMAIN_SPAM_TLDS: z
    .string()
    .default(
      ".tk .ml .ga .cf .gq .top .xyz .vip .club .bond .cam .ink .life .media .wang .quest .host",
    ),

  // G-NAF dataset release version
  GNAF_VERSION: z.string().default("MAY 2026"),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = envSchema.parse(process.env);
  }
  return _config;
}

/** Reset the cached config (useful for testing). */
export function resetConfig(): void {
  _config = null;
}
