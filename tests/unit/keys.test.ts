import { describe, expect, test } from "bun:test";

// Test the key/domain validation logic by duplicating the pure functions
// (same pattern as tests/unit/suggest.test.ts for sanitizeQuery)

function validateDomain(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.startsWith("http") ? input : `https://${input}`);
  } catch {
    return null;
  }
  const hostname = url.hostname;

  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;
  if (/^\[/.test(hostname)) return null;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "") return null;
  if (!hostname.includes(".")) return null;

  return hostname;
}

function generateKeyPrefix(rawKey: string): string {
  return rawKey.startsWith("gnaf_pk_") ? rawKey.slice(8, 16) : rawKey.slice(0, 8);
}

describe("validateDomain", () => {
  test("accepts standard domain", () => {
    expect(validateDomain("myapp.com")).toBe("myapp.com");
  });

  test("accepts domain with https prefix", () => {
    expect(validateDomain("https://myapp.com")).toBe("myapp.com");
  });

  test("accepts domain with http prefix", () => {
    expect(validateDomain("http://myapp.com")).toBe("myapp.com");
  });

  test("accepts subdomain", () => {
    expect(validateDomain("api.myapp.com.au")).toBe("api.myapp.com.au");
  });

  test("accepts www subdomain", () => {
    expect(validateDomain("www.myapp.com")).toBe("www.myapp.com");
  });

  test("rejects IP address", () => {
    expect(validateDomain("192.168.1.1")).toBeNull();
  });

  test("rejects localhost", () => {
    expect(validateDomain("localhost")).toBeNull();
  });

  test("rejects empty string", () => {
    expect(validateDomain("")).toBeNull();
  });

  test("rejects bare TLD without domain", () => {
    expect(validateDomain("com")).toBeNull();
  });

  test("rejects garbage input", () => {
    expect(validateDomain("not-a-domain!!")).toBeNull();
  });

  test("rejects string with spaces", () => {
    expect(validateDomain("my app.com")).toBeNull();
  });
});

describe("generateKeyPrefix", () => {
  test("extracts 8 chars after gnaf_pk_ prefix", () => {
    const key = `gnaf_pk_${"a".repeat(43)}`;
    expect(generateKeyPrefix(key)).toBe("a".repeat(8));
  });

  test("handles key without prefix", () => {
    const key = "abcdefghijkl";
    expect(generateKeyPrefix(key)).toBe("abcdefgh");
  });

  test("handles short key", () => {
    expect(generateKeyPrefix("abc")).toBe("abc");
  });

  test("extracts correct chars from real-looking key", () => {
    const raw = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_";
    const key = `gnaf_pk_${raw}`;
    expect(generateKeyPrefix(key)).toBe("AbCdEfGh");
  });
});

describe("key format", () => {
  test("generated key starts with gnaf_pk_", () => {
    const rawBytes = crypto.getRandomValues(new Uint8Array(32));
    const base64 = btoa(String.fromCodePoint(...rawBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const key = `gnaf_pk_${base64}`;
    expect(key.startsWith("gnaf_pk_")).toBe(true);
    // gnaf_pk_ (8) + 43 chars base64 = 51 chars total
    expect(key.length).toBeGreaterThanOrEqual(50);
    expect(key.length).toBeLessThanOrEqual(55);
  });

  test("key contains only URL-safe characters", () => {
    const rawBytes = crypto.getRandomValues(new Uint8Array(32));
    const base64 = btoa(String.fromCodePoint(...rawBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const key = `gnaf_pk_${base64}`;
    expect(/^[a-zA-Z0-9_-]+$/.test(key.slice(8))).toBe(true);
  });

  test("two generated keys are different", () => {
    const rawBytes1 = crypto.getRandomValues(new Uint8Array(32));
    const base641 = btoa(String.fromCodePoint(...rawBytes1)).replace(/[+/=]/g, "");
    const key1 = `gnaf_pk_${base641}`;

    const rawBytes2 = crypto.getRandomValues(new Uint8Array(32));
    const base642 = btoa(String.fromCodePoint(...rawBytes2)).replace(/[+/=]/g, "");
    const key2 = `gnaf_pk_${base642}`;

    expect(key1).not.toBe(key2);
  });
});
