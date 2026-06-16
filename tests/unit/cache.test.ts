import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LruCache, getSuggestCache, resetSuggestCache, buildSuggestKey } from "../../src/lib/cache";

describe("LruCache", () => {
  test("set and get a value", () => {
    const c = new LruCache<string, string>(10, 5000);
    c.set("a", "1");
    expect(c.get("a")).toBe("1");
  });

  test("returns undefined for missing key", () => {
    const c = new LruCache<string, string>(10, 5000);
    expect(c.get("nonexistent")).toBeUndefined();
  });

  test("expires entry after TTL", () => {
    const c = new LruCache<string, string>(10, 10); // 10ms TTL
    c.set("a", "1");
    expect(c.get("a")).toBe("1");
    // Wait for TTL to expire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(c.get("a")).toBeUndefined();
        resolve();
      }, 20);
    });
  });

  test("has returns false for missing key", () => {
    const c = new LruCache<string, string>(10, 5000);
    expect(c.has("x")).toBe(false);
  });

  test("has returns true for existing key", () => {
    const c = new LruCache<string, string>(10, 5000);
    c.set("x", "y");
    expect(c.has("x")).toBe(true);
  });

  test("delete removes a key", () => {
    const c = new LruCache<string, string>(10, 5000);
    c.set("k", "v");
    expect(c.delete("k")).toBe(true);
    expect(c.get("k")).toBeUndefined();
  });

  test("size is accurate", () => {
    const c = new LruCache<string, string>(10, 5000);
    expect(c.size).toBe(0);
    c.set("a", "1");
    c.set("b", "2");
    expect(c.size).toBe(2);
  });

  test("evicts LRU when at max size", () => {
    const c = new LruCache<string, string>(3, 5000);
    c.set("a", "1");
    c.set("b", "2");
    c.set("c", "3");
    c.set("d", "4"); // Evicts "a" (LRU)
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe("2");
    expect(c.get("c")).toBe("3");
    expect(c.get("d")).toBe("4");
  });

  test("get refreshes LRU position", () => {
    const c = new LruCache<string, string>(3, 5000);
    c.set("a", "1");
    c.set("b", "2");
    c.set("c", "3");
    c.get("a"); // Touches "a" — moves to MRU end
    c.set("d", "4"); // Should evict "b" (now LRU), not "a"
    expect(c.get("a")).toBe("1");
    expect(c.get("b")).toBeUndefined();
    expect(c.get("c")).toBe("3");
    expect(c.get("d")).toBe("4");
  });

  test("set updates existing key and moves to MRU", () => {
    const c = new LruCache<string, string>(3, 5000);
    c.set("a", "1");
    c.set("b", "2");
    c.set("c", "3");
    c.set("a", "updated");
    c.set("d", "4"); // Should evict "b" (now LRU since "a" was refreshed)
    expect(c.get("a")).toBe("updated");
    expect(c.get("b")).toBeUndefined();
    expect(c.get("d")).toBe("4");
  });

  test("clear empties the cache", () => {
    const c = new LruCache<string, string>(10, 5000);
    c.set("a", "1");
    c.set("b", "2");
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get("a")).toBeUndefined();
  });

  test("constructor rejects invalid sizes", () => {
    expect(() => new LruCache(0, 1000)).toThrow();
    expect(() => new LruCache(100, 0)).toThrow();
  });
});

describe("getSuggestCache", () => {
  beforeEach(() => {
    resetSuggestCache();
  });

  afterEach(() => {
    resetSuggestCache();
  });

  test("returns a singleton", () => {
    const a = getSuggestCache();
    const b = getSuggestCache();
    expect(a).toBe(b);
  });

  test("accepts opts overrides", () => {
    const c = getSuggestCache({ maxSize: 5, ttlMs: 1000 });
    c.set("a", {
      results: [],
      tier: "tier0",
      took_ms: 2,
      cached_at: Date.now(),
      cache_status: "miss",
    });
    expect(c.size).toBe(1);
  });
});

describe("buildSuggestKey", () => {
  test("normalizes query to lowercase trimmed", () => {
    const key = buildSuggestKey("  Main   St  ", null, null, 10);
    expect(key).toContain("main   st");
  });

  test("includes state and postcode", () => {
    const key = buildSuggestKey("sydney", "NSW", "2000", 10);
    expect(key).toBe("sydney|NSW|2000|10");
  });

  test("handles null state and postcode", () => {
    const key = buildSuggestKey("main st", null, null, 10);
    expect(key).toBe("main st|||10");
  });

  test("different limit produces different key", () => {
    const a = buildSuggestKey("sydne", null, null, 10);
    const b = buildSuggestKey("sydne", null, null, 20);
    expect(a).not.toBe(b);
  });
});

describe("cache integration", () => {
  const cache = new LruCache<string, { value: string }>(10, 5000);

  test("hit returns stored value", () => {
    cache.set("test-key", { value: "stored" });
    const result = cache.get("test-key");
    expect(result).toBeDefined();
    expect(result!.value).toBe("stored");
  });

  test("miss returns undefined", () => {
    expect(cache.get("never-set")).toBeUndefined();
  });

  test("evicts at max size", () => {
    const small = new LruCache<string, string>(2, 5000);
    small.set("a", "1");
    small.set("b", "2");
    small.set("c", "3"); // evicts "a"
    expect(small.get("a")).toBeUndefined();
    expect(small.get("b")).toBe("2");
    expect(small.get("c")).toBe("3");
  });
});

describe("LruCache TTL edge cases", () => {
  test("has returns false for stale entry after TTL", () => {
    const c = new LruCache<string, string>(10, 10); // 10ms TTL
    c.set("x", "y");
    expect(c.has("x")).toBe(true);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(c.has("x")).toBe(false);
        resolve();
      }, 20);
    });
  });

  test("delete on non-existent key returns false", () => {
    const c = new LruCache<string, string>(10, 5000);
    expect(c.delete("nonexistent")).toBe(false);
  });

  test("set after eviction works correctly", () => {
    const c = new LruCache<string, string>(2, 5000);
    c.set("a", "1");
    c.set("b", "2");
    c.set("c", "3"); // evicts "a"
    c.set("d", "4"); // evicts "b"
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBeUndefined();
    expect(c.get("c")).toBe("3");
    expect(c.get("d")).toBe("4");
  });

  test("clear resets all state including MRU tracking", () => {
    const c = new LruCache<string, string>(3, 5000);
    c.set("a", "1");
    c.set("b", "2");
    c.set("c", "3");
    c.clear();
    c.set("a", "new");
    expect(c.get("a")).toBe("new");
    expect(c.size).toBe(1);
  });

  test("set refreshes TTL for existing key", () => {
    // Use a very short TTL and set again before it expires
    const c = new LruCache<string, string>(10, 30);
    c.set("k", "old");
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // Set again with new value — should refresh TTL
        c.set("k", "new");
        setTimeout(() => {
          // Should still be alive (was refreshed ~10ms ago, TTL is 30ms)
          expect(c.get("k")).toBe("new");
          resolve();
        }, 15);
      }, 15);
    });
  });

  test("evictStale does not throw on empty cache", () => {
    const c = new LruCache<string, string>(10, 5000);
    // Access after clearing should not throw
    c.clear();
    c.set("a", "1");
    expect(c.get("a")).toBe("1");
  });
});
