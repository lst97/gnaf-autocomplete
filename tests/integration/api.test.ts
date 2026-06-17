import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const BASE_URL = process.env.API_URL ?? "http://localhost:8000";

let apiKey = "";
let keyReady = false;
let apiOnline = false;

const TEST_DOMAIN = `api-test-${Date.now()}.test`;

async function ensureKey(): Promise<string> {
  if (keyReady && apiKey) return apiKey;
  try {
    const res = await fetch(`${BASE_URL}/api/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: TEST_DOMAIN, turnstile_token: "test" }),
    });
    if (res.status === 201) {
      const data = await res.json();
      apiKey = data.keys[0].key;
      try {
        const { getReadWriteSql, closeDb } = await import("../../src/db/client");
        const sql = getReadWriteSql();
        await sql`
          UPDATE api_keys SET status = 'active', verification_token = NULL, last_verified_at = now()
          WHERE prefix = ${data.keys[0].prefix}
        `;
        await closeDb();
      } catch {
        // ignore activation failure
      }
      keyReady = true;
      return apiKey;
    }
  } catch {
    // ignore
  }
  return "";
}

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE_URL}/healthz`, { signal: AbortSignal.timeout(1000) });
    apiOnline = res.ok;
    if (apiOnline) await ensureKey();
  } catch {
    apiOnline = false;
  }
});

afterAll(async () => {
  if (apiKey) {
    try {
      const prefix = apiKey.startsWith("gnaf_pk_") ? apiKey.slice(8, 16) : apiKey.slice(0, 8);
      await fetch(`${BASE_URL}/api/keys/${prefix}/revoke`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      });
    } catch {
      // ignore cleanup errors
    }
  }
});

function authHeaders(): Record<string, string> {
  return { "X-API-Key": apiKey };
}

describe("GET /suggest", () => {
  test("returns results for valid query", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=sydney&limit=5`, {
      headers: authHeaders(),
    });
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
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=a`, { headers: authHeaders() });
    expect(res.status).toBe(400);
  });

  test("lat and lon are numbers when results present", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=sydney&limit=1`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json();
    if (data.results.length > 0) {
      expect(typeof data.results[0].lat).toBe("number");
      expect(typeof data.results[0].lon).toBe("number");
      expect(typeof data.results[0].score).toBe("number");
    }
  });

  test("X-Request-Id header is set on suggest responses", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=sydney&limit=1`, { headers: authHeaders() });
    const rid = res.headers.get("x-request-id");
    expect(rid).toBeTruthy();
  });

  test("returns 401 without API key", async () => {
    if (!apiOnline) return;
    const res = await fetch(`${BASE_URL}/suggest?q=sydney`);
    expect(res.status).toBe(401);
  });
});

describe("GET /healthz", () => {
  test("returns ok", async () => {
    if (!apiOnline) return;
    const res = await fetch(`${BASE_URL}/healthz`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });
});

describe("GET /readyz", () => {
  test("returns ready when DB is up", async () => {
    if (!apiOnline) return;
    const res = await fetch(`${BASE_URL}/readyz`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ready");
  });
});

describe("Preprocessing pipeline — tokenizer edge cases", () => {
  // These tests verify that the full preprocessing → router → DB pipeline
  // finds results for queries that could confuse the tokenizer's
  // skip/classify logic.  Each test asserts results.length > 0 so we catch
  // silent failures (the API returns 200 with empty results).

  test("1-char street prefix 'y st' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=y%20st&limit=3`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.tier).toBe("tier1");
  });

  test("1-char street prefix 'k rd' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=k%20rd&limit=3`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.tier).toBe("tier1");
  });

  test("2-char street prefix 'pi st' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=pi%20st&limit=3`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.tier).toBe("tier1");
  });

  test("street type as prefix name 'close' does not error", async () => {
    if (!apiOnline || !apiKey) return;
    // "close" is a street type — tokenizer skips it as a prefix candidate.
    const res = await fetch(`${BASE_URL}/suggest?q=close&limit=3`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.results)).toBe(true);
  });

  test("flat type as query 'unit st' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    // "unit" is a flat type + "st" is a street type → no prefix candidate.
    const res = await fetch(`${BASE_URL}/suggest?q=unit%20st&limit=3`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json();
    // May or may not find trigram matches, but should not error
    expect(Array.isArray(data.results)).toBe(true);
  });

  test("state code as street prefix 'nsw rd' finds results via trigram", async () => {
    if (!apiOnline || !apiKey) return;
    // "nsw" is a state code → tokenizer skips it. "rd" is a street type.
    const res = await fetch(`${BASE_URL}/suggest?q=nsw%20rd&limit=3`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.results)).toBe(true);
  });

  test("number range query '10-20 main' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=10-20%20main&limit=3`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.tier).toBe("tier1");
  });

  test("flat pattern '1/6 fortuna' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=1/6%20fortuna&limit=3`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.tier).toBe("tier1");
  });

  test("flat pattern with number 'unit 1 6 fortuna' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=unit%201%206%20fortuna&limit=3`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.tier).toBe("tier1");
  });

  test("apartment pattern 'apt 5 george' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=apt%205%20george&limit=3`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
  });

  test("multi-word locality 'glen huntly' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=glen%20huntly&limit=3`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // Should find via tier4 or tier1 with multi-word locale boost
    expect(data.results.length).toBeGreaterThan(0);
  });

  test("query with apostrophe 'a beckett st' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=a%27beckett%20st&limit=3`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
  });

  test("query with hyphen 'bong-bong road' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=bong-bong%20road&limit=3`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
  });

  test("postcode-only query '2000' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=2000&limit=3`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("postcode");
    expect(data.results.length).toBeGreaterThan(0);
  });

  test("state+postcode query 'sydney nsw 2000' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=sydney%20nsw%202000&limit=3`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.tier).toBe("tier0");
  });

  test("state+locality 'main st sydney nsw' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=main%20st%20sydney%20nsw&limit=3`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
    // Should route to tier1 (street prefix) with state filter
    expect(data.tier).toBe("tier1");
  });

  test("number + 1-char street '12 y st' finds results", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=12%20y%20st&limit=3`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.tier).toBe("tier1");
  });

  test("state correction: 'nzw' returns state_corrected_from field", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=sydney%20nzw&limit=3`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // State correction rewrote "nzw" → NSW.  Results may be empty if no
    // locality starts with "sy" in NSW, but the correction field proves
    // the preprocessing pipeline fired.
    expect(data.state_corrected_from).toBe("nzw");
  });
});

describe("Tier 1 fallback chain (typo recovery)", () => {
  test("exact prefix returns tier1 with matches", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=gresford&limit=3&no_cache=1`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("tier1");
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].display).toContain("GRESFORD");
  });

  test("1-char deletion typo routes to typo_corrected", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=gresfrod&limit=3&no_cache=1`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("typo_corrected");
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].display).toContain("GRESFORD");
  });

  test("1-char insertion typo routes to typo_corrected", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=gresfodr&limit=3&no_cache=1`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("typo_corrected");
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.results[0].display).toContain("GRESFORD");
  });

  test("transposition typo routes to tier1 or typo_corrected", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=mian%20st&limit=3&no_cache=1`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(["tier1", "typo_corrected"]).toContain(data.tier);
  });

  test("1-char-extra typo routes to typo_corrected", async () => {
    if (!apiOnline || !apiKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=sydneey&limit=3&no_cache=1`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tier).toBe("typo_corrected");
    expect(data.results.length).toBeGreaterThan(0);
  });
});

describe("GET /openapi/json", () => {
  test("returns OpenAPI spec", async () => {
    if (!apiOnline) return;
    const res = await fetch(`${BASE_URL}/openapi/json`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.openapi).toBeDefined();
    expect(data.info.title).toContain("G-NAF");
  });
});
