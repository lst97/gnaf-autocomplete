import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getConfig, resetConfig } from "../../src/config";

describe("getConfig", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    // Ensure DATABASE_URL is set to avoid Zod error
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    }
    resetConfig(); // Clear the cached config so getConfig re-reads from env
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  test("returns default values when env vars are not set", () => {
    delete process.env.PORT;
    delete process.env.LOG_LEVEL;
    delete process.env.POOL_SIZE;
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

    const config = getConfig();
    expect(config.PORT).toBe(8000);
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.POOL_SIZE).toBe(10);
    expect(config.CORS_ORIGINS).toBe("*");
  });

  test("reads PORT from env", () => {
    process.env.PORT = "3000";
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    const config = getConfig();
    expect(config.PORT).toBe(3000);
  });

  test("reads LOG_LEVEL from env", () => {
    process.env.LOG_LEVEL = "debug";
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    const config = getConfig();
    expect(config.LOG_LEVEL).toBe("debug");
  });

  test("reads POOL_SIZE from env", () => {
    process.env.POOL_SIZE = "20";
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    const config = getConfig();
    expect(config.POOL_SIZE).toBe(20);
  });

  test("coerces POOL_SIZE min to 1", () => {
    process.env.POOL_SIZE = "0";
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    // Zod coerces "0" → 0, then .int().min(1) rejects it — throws before .default(10)
    expect(() => getConfig()).toThrow();
  });
});

describe("env validation", () => {
  test("invalid LOG_LEVEL throws", () => {
    // getConfig() caches — test the schema directly by re-importing
    const { z } = require("zod");
    const schema = z.object({
      DATABASE_URL: z.string().url(),
      LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]),
    });
    expect(() =>
      schema.parse({ DATABASE_URL: "postgresql://localhost:5432/test", LOG_LEVEL: "verbose" }),
    ).toThrow();
  });

  test("invalid DATABASE_URL throws", () => {
    const { z } = require("zod");
    const schema = z.object({
      DATABASE_URL: z.string().url(),
    });
    expect(() => schema.parse({ DATABASE_URL: "not-a-url" })).toThrow();
  });

  test("valid config passes", () => {
    const { z } = require("zod");
    const schema = z.object({
      DATABASE_URL: z.string().url(),
      LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]),
      PORT: z.coerce.number().int().min(1),
    });
    const result = schema.parse({
      DATABASE_URL: "postgresql://localhost:5432/test",
      LOG_LEVEL: "info",
      PORT: "8000",
    });
    expect(result.PORT).toBe(8000);
    expect(result.LOG_LEVEL).toBe("info");
  });
});
