import { env } from "../env";

/**
 * Minimal O(1) LRU cache backed by Map insertion-order.
 * No external dependencies — pure ES2022 Map semantics.
 *
 * When the cache exceeds `maxSize`, the least-recently-used entry
 * (first entry in insertion order) is evicted before inserting the new one.
 * Entries expire after `ttlMs` milliseconds from insertion.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, { value: V; ts: number }>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    if (maxSize < 1) throw new RangeError("maxSize must be >= 1");
    if (ttlMs < 1) throw new RangeError("ttlMs must be >= 1");
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;
    if (Date.now() - entry.ts > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.evictStale();

    if (this.map.has(key)) {
      this.map.delete(key);
    }

    while (this.map.size >= this.maxSize) {
      const lruKey = this.map.keys().next();
      if (lruKey.done) break;
      this.map.delete(lruKey.value);
    }

    this.map.set(key, { value, ts: Date.now() });
  }

  has(key: K): boolean {
    const entry = this.map.get(key);
    if (entry === undefined) return false;
    if (Date.now() - entry.ts > this.ttlMs) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  private evictStale(): void {
    const now = Date.now();
    for (const [key, entry] of this.map) {
      if (now - entry.ts > this.ttlMs) {
        this.map.delete(key);
      }
    }
  }
}

export interface CachedSuggestResponse {
  results: Array<{
    id: string;
    display: string;
    lat: number | null;
    lon: number | null;
    state: string;
    postcode: string;
    score: number;
  }>;
  tier: string;
  took_ms: number;
  cached_at: number;
  cache_status: "hit" | "miss";
  corrected_from?: string;
  locality_corrected_from?: string;
  state_corrected_from?: string;
}

/**
 * Normalize a cache key from query parameters.
 * Lowercases and trims to collapse whitespace-only differences.
 */
export function buildSuggestKey(
  q: string,
  state: string | null,
  postcode: string | null,
  limit: number,
): string {
  const parts = [q.trim().toLowerCase(), state ?? "", postcode ?? "", String(limit)];
  return parts.join("|");
}

let _cacheInstance: LruCache<string, CachedSuggestResponse> | null = null;

/**
 * Get or create the singleton suggest-result cache.
 * Configuration is read from environment variables with sensible defaults:
 *   SUGGEST_CACHE_MAX     — max entries (default 1000)
 *   SUGGEST_CACHE_TTL_MS  — TTL in ms (default 30000)
 */
export function getSuggestCache(opts?: {
  maxSize?: number;
  ttlMs?: number;
}): LruCache<string, CachedSuggestResponse> {
  if (!_cacheInstance) {
    const maxSize = opts?.maxSize ?? env.SUGGEST_CACHE_MAX;
    const ttlMs = opts?.ttlMs ?? env.SUGGEST_CACHE_TTL_MS;
    _cacheInstance = new LruCache<string, CachedSuggestResponse>(maxSize, ttlMs);
  }
  return _cacheInstance;
}

/** Reset the cache singleton (useful for testing). */
export function resetSuggestCache(): void {
  _cacheInstance = null;
}
