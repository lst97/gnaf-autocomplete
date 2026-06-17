import { describe, expect, test } from "bun:test";
import { z } from "zod";

/**
 * env.ts uses @t3-oss/env-core which creates a frozen, once-parsed object
 * at module import time.  Mutating process.env after import has NO effect
 * on the already-parsed env object.  These tests validate the Zod schema
 * directly rather than fighting the module cache.
 */

const SERVER_ENV = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  PUBLIC_URL: z.string().default(""),
  DATABASE_URL: z.string().url().default("postgresql://postgres:postgres@localhost:5433/gnaf"),
  DATABASE_URL_READWRITE: z.string().url().optional(),
  POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  CORS_ORIGINS: z.string().default(""),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  SUGGEST_CACHE_MAX: z.coerce.number().int().min(1).max(100_000).default(1000),
  SUGGEST_CACHE_TTL_MS: z.coerce.number().int().min(1000).max(3_600_000).default(30_000),
  TURNSTILE_SITE_KEY: z.string().default(""),
  TURNSTILE_SECRET_KEY: z.string().default(""),
  API_KEY_RATE_LIMIT: z.coerce.number().int().min(1).max(1_000_000).default(5000),
  API_KEY_RATE_WINDOW_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(3_600_000),
  KEYGEN_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(10),
  KEYGEN_RATE_WINDOW_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(3_600_000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

describe("env schema defaults", () => {
  test("all defaults are valid when no env vars set", () => {
    const parsed = SERVER_ENV.parse({});
    expect(parsed.PORT).toBe(8000);
    expect(parsed.LOG_LEVEL).toBe("info");
    expect(parsed.POOL_SIZE).toBe(10);
    expect(parsed.CORS_ORIGINS).toBe("");
    expect(parsed.DATABASE_URL).toBe("postgresql://postgres:postgres@localhost:5433/gnaf");
    expect(parsed.NODE_ENV).toBe("development");
  });

  test("coerces PORT from string", () => {
    const parsed = SERVER_ENV.parse({ PORT: "3000" });
    expect(parsed.PORT).toBe(3000);
  });

  test("coerces LOG_LEVEL", () => {
    const parsed = SERVER_ENV.parse({ LOG_LEVEL: "debug" });
    expect(parsed.LOG_LEVEL).toBe("debug");
  });

  test("coerces POOL_SIZE from string", () => {
    const parsed = SERVER_ENV.parse({ POOL_SIZE: "20" });
    expect(parsed.POOL_SIZE).toBe(20);
  });

  test("coerces POOL_SIZE min to 1", () => {
    expect(() => SERVER_ENV.parse({ POOL_SIZE: "0" })).toThrow();
  });

  test("invalid LOG_LEVEL throws", () => {
    expect(() => SERVER_ENV.parse({ LOG_LEVEL: "verbose" })).toThrow();
  });

  test("invalid DATABASE_URL throws", () => {
    expect(() => SERVER_ENV.parse({ DATABASE_URL: "not-a-url" })).toThrow();
  });

  test("valid minimal config passes", () => {
    const result = SERVER_ENV.parse({
      DATABASE_URL: "postgresql://localhost:5432/gnaf",
      LOG_LEVEL: "info",
    });
    expect(result.PORT).toBe(8000);
    expect(result.LOG_LEVEL).toBe("info");
  });

  test("empty CORS_ORIGINS defaults to empty string", () => {
    const parsed = SERVER_ENV.parse({ CORS_ORIGINS: "" });
    expect(parsed.CORS_ORIGINS).toBe("");
  });

  test("all cache defaults are valid", () => {
    const parsed = SERVER_ENV.parse({});
    expect(parsed.SUGGEST_CACHE_MAX).toBe(1000);
    expect(parsed.SUGGEST_CACHE_TTL_MS).toBe(30_000);
  });

  test("rate limit defaults are valid", () => {
    const parsed = SERVER_ENV.parse({});
    expect(parsed.API_KEY_RATE_LIMIT).toBe(5000);
    expect(parsed.API_KEY_RATE_WINDOW_MS).toBe(3_600_000);
    expect(parsed.KEYGEN_RATE_LIMIT).toBe(10);
    expect(parsed.KEYGEN_RATE_WINDOW_MS).toBe(3_600_000);
  });

  test("optional DATABASE_URL_READWRITE is undefined when not set", () => {
    const parsed = SERVER_ENV.parse({});
    expect(parsed.DATABASE_URL_READWRITE).toBeUndefined();
  });
});
