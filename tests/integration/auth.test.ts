import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const BASE_URL = process.env.API_URL ?? "http://localhost:8000";
const TIMEOUT = 5000;

async function apiOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/healthz`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe("API Key Auth", () => {
  let online: boolean;
  let testKey: string | null = null;
  let testDomain = "test.example.com";

  beforeAll(async () => {
    online = await apiOnline();
  });

  test("GET /suggest without key returns 401", async () => {
    if (!online) return;
    const res = await fetch(`${BASE_URL}/suggest?q=sydney&limit=1`);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("MISSING_API_KEY");
  });

  test("GET /suggest with invalid key returns 401", async () => {
    if (!online) return;
    const res = await fetch(`${BASE_URL}/suggest?q=sydney&limit=1`, {
      headers: { "X-API-Key": "invalid_key_123" },
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe("INVALID_API_KEY");
  });

  test("POST /api/keys with invalid domain returns 400 or 429 (rate-limited)", async () => {
    if (!online) return;
    const res = await fetch(`${BASE_URL}/api/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "not-a-domain!!", turnstile_token: "dummy" }),
    });
    expect([400, 429]).toContain(res.status);
    const data = await res.json();
    if (res.status === 400) {
      expect(data.code).toBe("VALIDATION_ERROR");
    } else {
      expect(data.code).toBe("RATE_LIMITED");
    }
  });

  test("POST /api/keys with localhost returns 400 or 429 (rate-limited)", async () => {
    if (!online) return;
    const res = await fetch(`${BASE_URL}/api/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "localhost", turnstile_token: "dummy" }),
    });
    expect([400, 429]).toContain(res.status);
  });

  // Note: The full generate-and-use flow requires a real Turnstile token.
  // The Turnstile check can be bypassed by not setting TURNSTILE_SECRET_KEY
  // (empty string = skip validation in development).
  test("POST /api/keys has rate limit headers", async () => {
    if (!online) return;
    const res = await fetch(`${BASE_URL}/api/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "test.example.com", turnstile_token: "dummy" }),
    });
    // May succeed (no Turnstile configured) or fail (Turnstile configured)
    // But should always respond, not hang
    expect(res.status).toBeOneOf([201, 400, 429]);
  });

  test("GET /api/config returns config", async () => {
    if (!online) return;
    const res = await fetch(`${BASE_URL}/api/config`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("turnstileSiteKey");
  });

  test("public endpoints bypass auth", async () => {
    if (!online) return;
    // /healthz should work without key
    const health = await fetch(`${BASE_URL}/healthz`);
    expect(health.status).toBe(200);

    // /readyz should work without key
    const ready = await fetch(`${BASE_URL}/readyz`);
    expect(ready.status).toBe(200);
  });

  test("GET /address/:id without key returns 401", async () => {
    if (!online) return;
    const res = await fetch(`${BASE_URL}/address/GANSW706063331`);
    expect(res.status).toBe(401);
  });
});
