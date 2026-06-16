import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const BASE_URL = process.env.API_URL ?? "http://localhost:8000";

let apiOnline = false;
let generatedKeys: Array<{ key: string; prefix: string }> = [];
const TEST_DOMAIN = `test-flow-${Date.now()}.example.com`;

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE_URL}/healthz`, { signal: AbortSignal.timeout(1000) });
    apiOnline = res.ok;
  } catch {
    apiOnline = false;
  }
});

afterAll(async () => {
  // Cleanup: revoke any keys we generated (best-effort)
  for (const { key, prefix } of generatedKeys) {
    try {
      await fetch(`${BASE_URL}/api/keys/${prefix}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": key },
      });
    } catch {
      // ignore cleanup failures
    }
  }
});

function jsonHeaders() {
  return { "Content-Type": "application/json" };
}

describe("POST /api/keys — key generation", () => {
  test("generates keys for a new domain", async () => {
    if (!apiOnline) return;
    const res = await fetch(`${BASE_URL}/api/keys`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ domain: TEST_DOMAIN, turnstile_token: "test" }),
    });
    // May be rate-limited (429) after repeated test runs against the same
    // API instance.  When rate-limited, skip the key-format assertions but
    // don't fail — the rate limiter is working as intended.
    const data = await res.json();
    if (res.status === 429) {
      expect(data.code).toBe("RATE_LIMITED");
      return;
    }
    expect(res.status).toBe(201);
    expect(data.keys.length).toBeGreaterThan(0);
    expect(data.keys.length).toBeLessThanOrEqual(5);
    expect(data.domain).toBe(TEST_DOMAIN);
    expect(data.generated_count).toBeGreaterThan(0);
    generatedKeys = data.keys.map((k: { key: string; prefix: string }) => ({
      key: k.key,
      prefix: k.prefix,
    }));
    for (const k of generatedKeys) {
      expect(k.key).toMatch(/^gnaf_pk_[A-Za-z0-9_-]{43,44}$/);
      expect(k.prefix.length).toBe(8);
    }
  });

  test("rejects invalid domain", async () => {
    if (!apiOnline) return;
    const res = await fetch(`${BASE_URL}/api/keys`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ domain: "not-a-domain", turnstile_token: "test" }),
    });
    expect([400, 429]).toContain(res.status);
    if (res.status === 400) {
      const data = await res.json();
      expect(data.code).toBe("VALIDATION_ERROR");
    }
  });

  test("rejects empty domain", async () => {
    if (!apiOnline) return;
    const res = await fetch(`${BASE_URL}/api/keys`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ domain: "", turnstile_token: "test" }),
    });
    expect([400, 429]).toContain(res.status);
  });

  test("rejects IP address as domain", async () => {
    if (!apiOnline) return;
    const res = await fetch(`${BASE_URL}/api/keys`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ domain: "192.168.1.1", turnstile_token: "test" }),
    });
    expect([400, 429]).toContain(res.status);
  });

  test("rejects localhost as domain", async () => {
    if (!apiOnline) return;
    const res = await fetch(`${BASE_URL}/api/keys`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ domain: "localhost", turnstile_token: "test" }),
    });
    expect([400, 429]).toContain(res.status);
  });
});

describe("GET /api/keys/:prefix/status — key status", () => {
  test("returns pending status for newly generated keys", async () => {
    if (!apiOnline || generatedKeys.length === 0) return;
    const res = await fetch(`${BASE_URL}/api/keys/${generatedKeys[0].prefix}/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("pending");
    expect(data.domain).toBe(TEST_DOMAIN);
  });

  test("returns 404 for non-existent prefix", async () => {
    if (!apiOnline) return;
    const res = await fetch(`${BASE_URL}/api/keys/NONEXIST1/status`);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/keys/manage — key management", () => {
  test("rejects manage with invalid API key", async () => {
    if (!apiOnline || generatedKeys.length === 0) return;
    const res = await fetch(`${BASE_URL}/api/keys/manage`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ domain: TEST_DOMAIN, api_key: "invalid_key_short" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects manage with wrong domain", async () => {
    if (!apiOnline || generatedKeys.length === 0) return;
    const res = await fetch(`${BASE_URL}/api/keys/manage`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        domain: "wrong-domain.example.com",
        api_key: generatedKeys[0].key,
      }),
    });
    expect(res.status).toBe(403);
  });

  test("rejects manage with pending key (needs activation)", async () => {
    if (!apiOnline || generatedKeys.length === 0) return;
    const res = await fetch(`${BASE_URL}/api/keys/manage`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ domain: TEST_DOMAIN, api_key: generatedKeys[0].key }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe("FORBIDDEN");
  });
});

describe("GET /api/config — public config", () => {
  test("returns Turnstile site key", async () => {
    if (!apiOnline) return;
    const res = await fetch(`${BASE_URL}/api/config`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("turnstileSiteKey");
  });
});

describe("GET /healthz and /readyz — health endpoints", () => {
  test("healthz returns ok", async () => {
    if (!apiOnline) return;
    const res = await fetch(`${BASE_URL}/healthz`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });

  test("readyz returns ready", async () => {
    if (!apiOnline) return;
    const res = await fetch(`${BASE_URL}/readyz`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ready");
  });
});

describe("Full key lifecycle after activation", () => {
  let activeKey: string;
  let activePrefix: string;

  beforeAll(async () => {
    // Activate a key directly via DB for testing the manage flow
    if (!apiOnline || generatedKeys.length === 0) return;
    try {
      const { getReadWriteSql, closeDb } = await import("../../src/db/client");
      const sql = getReadWriteSql();
      await sql`
        UPDATE api_keys SET status = 'active', verification_token = NULL, last_verified_at = now()
        WHERE prefix = ${generatedKeys[0].prefix}
      `;
      await closeDb();
      activeKey = generatedKeys[0].key;
      activePrefix = generatedKeys[0].prefix;
    } catch {
      // If DB connection fails, skip these tests
    }
  });

  test("manage returns keys for activated key", async () => {
    if (!activeKey || !activePrefix) return;
    const res = await fetch(`${BASE_URL}/api/keys/manage`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ domain: TEST_DOMAIN, api_key: activeKey }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("verified");
    expect(data.domain).toBe(TEST_DOMAIN);
    expect(data.keys.length).toBeGreaterThan(0);
    for (const k of data.keys) {
      expect(k).toHaveProperty("prefix");
      expect(k).toHaveProperty("status");
      expect(k).toHaveProperty("created_at");
    }
  });

  test("revoke key via API", async () => {
    if (!activeKey || !activePrefix) return;
    const res = await fetch(`${BASE_URL}/api/keys/${activePrefix}/revoke`, {
      method: "POST",
      headers: { "X-API-Key": activeKey, "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("revoked");
  });

  test("revoked key status shows revoked", async () => {
    if (!activePrefix) return;
    const res = await fetch(`${BASE_URL}/api/keys/${activePrefix}/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("revoked");
  });

  test("revoked key cannot be used for auth", async () => {
    if (!activeKey) return;
    const res = await fetch(`${BASE_URL}/suggest?q=sydney`, {
      headers: { "X-API-Key": activeKey },
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe("KEY_REVOKED");
  });
});

describe("DNS verification flow (mocked DNS)", () => {
  test("key verification endpoint returns pending when DNS not set up", async () => {
    if (!apiOnline || generatedKeys.length < 2) return;
    // This key is still pending — try DNS verification
    const pendingPrefix = generatedKeys[1].prefix;
    const res = await fetch(`${BASE_URL}/api/keys/${pendingPrefix}/verify`, {
      method: "POST",
    });
    // Should return pending (or error about DNS) since no TXT record exists
    expect([200, 400, 502]).toContain(res.status);
  });

  test("recovery start with invalid domain is rejected", async () => {
    if (!apiOnline) return;
    const res = await fetch(`${BASE_URL}/api/keys/recover/start`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ domain: "invalid!!", turnstile_token: "test" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("API key rate limiting headers", () => {
  test("suggest response includes rate limit headers with valid key", async () => {
    if (!apiOnline || generatedKeys.length === 0) return;
    // Activate a second key
    try {
      const { getReadWriteSql, closeDb } = await import("../../src/db/client");
      const sql = getReadWriteSql();
      await sql`
        UPDATE api_keys SET status = 'active', verification_token = NULL, last_verified_at = now()
        WHERE prefix = ${generatedKeys[generatedKeys.length - 1].prefix}
      `;
      await closeDb();
    } catch {
      return;
    }

    const lastKey = generatedKeys[generatedKeys.length - 1].key;
    const res = await fetch(`${BASE_URL}/suggest?q=sydney`, {
      headers: { "X-API-Key": lastKey },
    });
    expect(res.status).toBe(200);
    const rateLimit = res.headers.get("x-ratelimit-limit");
    const rateRemaining = res.headers.get("x-ratelimit-remaining");
    const keyStatus = res.headers.get("x-key-status");
    expect(rateLimit).toBeTruthy();
    expect(rateRemaining).toBeTruthy();
    expect(keyStatus).toBe("active");
  });
});
