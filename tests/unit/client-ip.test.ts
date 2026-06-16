import { describe, expect, test } from "bun:test";
import { getRealIp } from "../../src/lib/client-ip";

function makeRequest(headers: Record<string, string>): Request {
  return new Request("http://localhost", { headers });
}

describe("getRealIp", () => {
  test("returns cf-connecting-ip when cf-ray is present", () => {
    const req = makeRequest({
      "cf-ray": "abc123",
      "cf-connecting-ip": "203.0.113.42",
    });
    expect(getRealIp(req)).toBe("203.0.113.42");
  });

  test("returns 'unknown' when cf-ray present but cf-connecting-ip missing", () => {
    const req = makeRequest({ "cf-ray": "abc123" });
    expect(getRealIp(req)).toBe("unknown");
  });

  test("returns 'unknown' when no proxy headers are present", () => {
    const req = makeRequest({});
    expect(getRealIp(req)).toBe("unknown");
  });

  test("returns 'unknown' when only x-forwarded-for is set (no cf-ray)", () => {
    // x-forwarded-for is intentionally ignored — it's spoofable
    const req = makeRequest({ "x-forwarded-for": "1.2.3.4" });
    expect(getRealIp(req)).toBe("unknown");
  });

  test("returns cf-connecting-ip with IPv6 address", () => {
    const req = makeRequest({
      "cf-ray": "xyz789",
      "cf-connecting-ip": "2001:db8::1",
    });
    expect(getRealIp(req)).toBe("2001:db8::1");
  });

  test("returns empty string when cf-connecting-ip is empty string", () => {
    // The `??` operator only catches null/undefined, so "" passes through
    const req = makeRequest({
      "cf-ray": "abc123",
      "cf-connecting-ip": "",
    });
    expect(getRealIp(req)).toBe("");
  });

  test("routing through Cloudflare: cf-ray takes priority over other headers", () => {
    const req = makeRequest({
      "cf-ray": "abc123",
      "cf-connecting-ip": "198.51.100.1",
      "x-forwarded-for": "1.2.3.4",
      "x-real-ip": "5.6.7.8",
    });
    // Should trust cf-connecting-ip, not x-forwarded-for or x-real-ip
    expect(getRealIp(req)).toBe("198.51.100.1");
  });
});
