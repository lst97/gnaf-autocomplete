import { beforeEach, describe, expect, test } from "bun:test";
import { generateRequestId, getOrGenerateRequestId } from "../../src/lib/request";

/**
 * getOrGenerateRequestId uses a module-level WeakMap.
 * Each test creates fresh Request objects, so no cross-contamination.
 */

describe("getOrGenerateRequestId", () => {
  function makeRequest(headers: Record<string, string> = {}): Request {
    return new Request("http://localhost", { headers });
  }

  test("generates a UUID for a request without X-Request-Id header", () => {
    const req = makeRequest();
    const id = getOrGenerateRequestId(req);
    expect(id).toMatch(
      /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/,
    );
  });

  test("returns same ID for same Request instance (WeakMap cache)", () => {
    const req = makeRequest();
    const a = getOrGenerateRequestId(req);
    const b = getOrGenerateRequestId(req);
    expect(a).toBe(b);
  });

  test("returns different IDs for different Request instances", () => {
    const req1 = makeRequest();
    const req2 = makeRequest();
    const id1 = getOrGenerateRequestId(req1);
    const id2 = getOrGenerateRequestId(req2);
    expect(id1).not.toBe(id2);
  });

  test("honours a valid inbound X-Request-Id header", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const req = makeRequest({ "X-Request-Id": uuid });
    const id = getOrGenerateRequestId(req);
    expect(id).toBe(uuid);
  });

  test("ignores invalid (non-UUID) X-Request-Id and generates new", () => {
    const req = makeRequest({ "X-Request-Id": "not-a-uuid" });
    const id = getOrGenerateRequestId(req);
    expect(id).toMatch(
      /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/,
    );
    expect(id).not.toBe("not-a-uuid");
  });

  test("ignores X-Request-Id with wrong format (missing dashes)", () => {
    const req = makeRequest({ "X-Request-Id": "550e8400e29b41d4a716446655440000" });
    const id = getOrGenerateRequestId(req);
    expect(id).not.toBe("550e8400e29b41d4a716446655440000");
  });

  test("caches the inbound header value", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const req = makeRequest({ "X-Request-Id": uuid });
    const a = getOrGenerateRequestId(req);
    const b = getOrGenerateRequestId(req);
    expect(a).toBe(uuid);
    expect(b).toBe(a);
  });

  test("ignores X-Request-Id that is too long", () => {
    const long = "550e8400-e29b-41d4-a716-446655440000" + "extra";
    const req = makeRequest({ "X-Request-Id": long });
    const id = getOrGenerateRequestId(req);
    expect(id).not.toBe(long);
    expect(id).toMatch(
      /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/,
    );
  });
});

describe("generateRequestId", () => {
  test("returns a UUID v4 string", () => {
    const id = generateRequestId();
    expect(id).toMatch(
      /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/,
    );
  });

  test("returns different IDs on successive calls", () => {
    const a = generateRequestId();
    const b = generateRequestId();
    expect(a).not.toBe(b);
  });

  test("is fast (no side effects)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRequestId());
    }
    expect(ids.size).toBe(100);
  });
});
