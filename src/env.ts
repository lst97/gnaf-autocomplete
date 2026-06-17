import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    // ── Runtime ──
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    // ── Server ──
    PORT: z.coerce.number().int().min(1).max(65535).default(8000),
    PUBLIC_URL: z.string().default(""),

    // ── PostgreSQL ──
    DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5433/gnaf"),
    DATABASE_URL_READWRITE: z.string().url().optional(),
    POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),

    // ── CORS ──
    CORS_ORIGINS: z.string().default(""),

    // ── Logging ──
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

    // ── Suggest cache ──
    SUGGEST_CACHE_MAX: z.coerce.number().int().min(1).max(100_000).default(1000),
    SUGGEST_CACHE_TTL_MS: z.coerce.number().int().min(1000).max(3_600_000).default(30_000),

    // ── Cloudflare Turnstile ──
    TURNSTILE_SITE_KEY: z.string().default(""),
    TURNSTILE_SECRET_KEY: z.string().default(""),

    // ── Per-key rate limiting ──
    API_KEY_RATE_LIMIT: z.coerce.number().int().min(1).max(1_000_000).default(5000),
    API_KEY_RATE_WINDOW_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(3_600_000),

    // ── Key generation rate limit (per IP) ──
    KEYGEN_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(10),
    KEYGEN_RATE_WINDOW_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(3_600_000),

    // ── Domain validation ──
    MAX_KEYS_PER_DOMAIN: z.coerce.number().int().min(1).max(100).default(5),
    DOMAIN_SPAM_TLDS: z
      .string()
      .default(
        ".tk .ml .ga .cf .gq .top .xyz .vip .club .bond .cam .ink .life .media .wang .quest .host",
      ),

    // ── G-NAF data ──
    GNAF_DATA_DIR: z.string().default(""),
    GNAF_VERSION: z.string().default("MAY 2026"),

    // ── Loader (used by scripts/load-worker.ts) ──
    GNAF_STATE: z.string().optional(),
    GNAF_STATE_LABEL: z.string().optional(),
    GNAF_START_ROW: z.coerce.number().optional(),
    GNAF_END_ROW: z.coerce.number().optional(),
  },

  // This is a pure backend — no client-exposed env vars.
  clientPrefix: "" as const,
  client: {},

  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
