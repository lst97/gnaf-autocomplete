import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { hashKey, verifyKey } from "../../src/lib/key-hash";

describe("hashKey", () => {
  test("returns a 64-character hex string", () => {
    const hash = hashKey("gnaf_pk_test123");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("same key produces the same hash", () => {
    const a = hashKey("gnaf_pk_abc123");
    const b = hashKey("gnaf_pk_abc123");
    expect(a).toBe(b);
  });

  test("different keys produce different hashes", () => {
    const a = hashKey("gnaf_pk_abc123");
    const b = hashKey("gnaf_pk_def456");
    expect(a).not.toBe(b);
  });

  test("empty string produces a valid hash", () => {
    const hash = hashKey("");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("matches Node.js crypto SHA-256 directly", () => {
    const raw = "gnaf_pk_test_key_value";
    const expected = createHash("sha256").update(raw).digest("hex");
    expect(hashKey(raw)).toBe(expected);
  });

  test("handles unicode characters", () => {
    const hash = hashKey("gnaf_pk_unicode_test_🔥");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("handles very long keys", () => {
    const long = "gnaf_pk_" + "a".repeat(1000);
    const hash = hashKey(long);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("verifyKey", () => {
  test("returns true for matching key and hash", () => {
    const raw = "gnaf_pk_test_key";
    const hash = hashKey(raw);
    expect(verifyKey(raw, hash)).toBe(true);
  });

  test("returns false for wrong key", () => {
    const hash = hashKey("gnaf_pk_correct_key");
    expect(verifyKey("gnaf_pk_wrong_key", hash)).toBe(false);
  });

  test("returns false for empty key against non-empty hash", () => {
    const hash = hashKey("gnaf_pk_something");
    expect(verifyKey("", hash)).toBe(false);
  });

  test("returns false for non-hex stored hash", () => {
    expect(verifyKey("gnaf_pk_test", "not-a-hex-string")).toBe(false);
  });

  test("returns false when stored hash has wrong length", () => {
    expect(verifyKey("gnaf_pk_test", "abcd")).toBe(false);
  });

  test("constant-time comparison: different-length hashes return false", () => {
    const hash = hashKey("gnaf_pk_test");
    const truncated = hash.slice(0, 32);
    expect(verifyKey("gnaf_pk_test", truncated)).toBe(false);
  });

  test("case-sensitive verification", () => {
    const raw = "gnaf_pk_MixedCaseKey";
    const hash = hashKey(raw);
    expect(verifyKey("gnaf_pk_mixedcasekey", hash)).toBe(false);
  });

  test("round-trip: hash then verify", () => {
    const keys = [
      "gnaf_pk_abc123",
      "gnaf_pk_xyz789",
      "gnaf_pk_",
      "gnaf_pk_" + "z".repeat(43),
    ];
    for (const key of keys) {
      const hash = hashKey(key);
      expect(verifyKey(key, hash)).toBe(true);
    }
  });
});
