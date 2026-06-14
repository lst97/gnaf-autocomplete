import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const BASE_URL = process.env.API_URL ?? "http://localhost:8000";
const TIMEOUT = 3000;

async function apiOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/healthz`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe("GET /suggest", () => {
  let online: boolean;

  beforeAll(async () => {
    online = await apiOnline();
  });

  test("returns results for valid query", async () => {
    if (!online) return;
    const res = await fetch(`${BASE_URL}/suggest?q=sydney&limit=5`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results.length).toBeLessThanOrEqual(5);
    expect(data.took_ms).toBeTypeOf("number");
    expect(data.results[0]).toHaveProperty("id");
    expect(data.results[0]).toHaveProperty("display");
    expect(data.results[0]).toHaveProperty("lat");
    expect(data.results[0]).toHaveProperty("lon");
    expect(data.results[0]).toHaveProperty("state");
    expect(data.results[0]).toHaveProperty("postcode");
    expect(data.results[0]).toHaveProperty("score");
  });

  test("returns 400 for q < 2 chars", async () => {
    if (!online) return;
    const res = await fetch(`${BASE_URL}/suggest?q=a`);
    expect(res.status).toBe(400);
  });

  test("lat and lon are numbers when results present", async () => {
    if (!(await apiOnline())) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${BASE_URL}/suggest?q=12&limit=1`, { signal: controller.signal });
    clearTimeout(timer);
    const data = await res.json();
    if (data.results.length > 0) {
      expect(typeof data.results[0].lat).toBe("number");
      expect(typeof data.results[0].lon).toBe("number");
      expect(typeof data.results[0].score).toBe("number");
    }
  });

  test("Cache-Control header is set", async () => {
    if (!online) return;
    const res = await fetch(`${BASE_URL}/suggest?q=sydney&limit=1`);
    const cache = res.headers.get("cache-control");
    expect(cache).toContain("public");
  });

  test("X-Request-Id header is set", async () => {
    if (!online) return;
    const res = await fetch(`${BASE_URL}/suggest?q=sydney&limit=1`);
    const rid = res.headers.get("x-request-id");
    expect(rid).toBeTruthy();
  });
});

describe("GET /healthz", () => {
  test("returns ok", async () => {
    if (!(await apiOnline())) return;
    const res = await fetch(`${BASE_URL}/healthz`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });
});

describe("GET /readyz", () => {
  test("returns ready when DB is up", async () => {
    if (!(await apiOnline())) return;
    const res = await fetch(`${BASE_URL}/readyz`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ready");
  });
});

/**
 * Tier 1/1b/1c fallback chain — exercises the fuzzy-street typo recovery.
 * These tests are the regression guard for the bug where the pg_trgm
 * similarity_threshold was not applied to all pool connections, causing
 * tier 1b to silently miss matches like "gresfodr" → "GRESFORD" (sim 0.5).
 *
 * Tier 1b uses GIN trigram on street_lc, gated by set_limit() AND
 * the per-connection `options: -c pg_trgm.similarity_threshold=0.3` flag
 * in src/db/client.ts. Both must be in effect for these tests to pass.
 */
describe("Tier 1 fallback chain (typo recovery)", () => {
  // Each test: if the API is offline, skip.
  const skipUnlessOnline = async () => {
    if (!(await apiOnline())) return false;
    return true;
  };

  test("exact prefix returns tier1 with matches (no fallthrough)", async () => {
    if (!(await skipUnlessOnline())) return;
    const res = await fetch(`${BASE_URL}/suggest?q=gresford&limit=3&no_cache=1`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("tier1");
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].display).toContain("GRESFORD");
  });

  test("1-char deletion typo ('gresfrod') routes to typo_corrected", async () => {
    if (!(await skipUnlessOnline())) return;
    const res = await fetch(`${BASE_URL}/suggest?q=gresfrod&limit=3&no_cache=1`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("typo_corrected");
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].display).toContain("GRESFORD");
  });

  test("1-char insertion typo ('gresfodr') routes to typo_corrected", async () => {
    if (!(await skipUnlessOnline())) return;
    const res = await fetch(`${BASE_URL}/suggest?q=gresfodr&limit=3&no_cache=1`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("typo_corrected");
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].display).toContain("GRESFORD");
  });

  test("number + 1-char typo ('31 gresfodr') routes to typo_corrected", async () => {
    if (!(await skipUnlessOnline())) return;
    const res = await fetch(`${BASE_URL}/suggest?q=31%20gresfodr&limit=3&no_cache=1`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("typo_corrected");
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].display).toContain("GRESFORD");
  });

  test("transposition typo ('mian st') routes to tier1 (exact prefix) or typo_corrected", async () => {
    if (!(await skipUnlessOnline())) return;
    const res = await fetch(`${BASE_URL}/suggest?q=mian%20st&limit=3&no_cache=1`);
    expect(res.status).toBe(200);
    const data = await res.json();
    // "mian" is a valid prefix ("MIANDAD ST") so tier1.
    // The corrector may also rewrite "mian" → "main" for a different street.
    expect(["tier1", "typo_corrected"]).toContain(data.tier);
  });

  test("1-char-extra typo ('sydneey') routes to typo_corrected", async () => {
    if (!(await skipUnlessOnline())) return;
    // The corrector rewrites "sydneey" → "sydney", then tier 1 finds SYDNEY AV
    const res = await fetch(`${BASE_URL}/suggest?q=sydneey&limit=3&no_cache=1`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("typo_corrected");
    expect(data.results.length).toBeGreaterThan(0);
  });

  test("all tier 1 fallback responses are fast", async () => {
    if (!(await skipUnlessOnline())) return;
    const queries = ["gresford", "gresfrod", "gresfodr", "sydneey"];
    for (const q of queries) {
      const start = performance.now();
      const res = await fetch(`${BASE_URL}/suggest?q=${encodeURIComponent(q)}&limit=3&no_cache=1`);
      const ms = performance.now() - start;
      expect(res.status).toBe(200);
      // 2s generous bound — typical for typo_corrected is <10ms (corrector + tier1).
      expect(ms).toBeLessThan(2000);
    }
  });
});

describe("GET /openapi/json", () => {
  test("returns OpenAPI spec", async () => {
    if (!(await apiOnline())) return;
    const res = await fetch(`${BASE_URL}/openapi/json`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.openapi).toBeDefined();
    expect(data.info.title).toContain("G-NAF");
  });
});
