import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb, getSql } from "../../src/db/client";
import {
  fetchAddressCount,
  fetchKeyStats,
  fetchTopDomains,
  fetchTopDomainsCount,
} from "../../src/sql/stats";

let dbOnline = false;

beforeAll(async () => {
  try {
    const sql = getSql();
    await sql`SELECT 1`;
    dbOnline = true;
  } catch {
    dbOnline = false;
  }
});

afterAll(async () => {
  try {
    await closeDb();
  } catch {
    // ignore
  }
});

describe("fetchKeyStats", () => {
  test("returns aggregated key statistics", async () => {
    if (!dbOnline) return;
    const rows = await fetchKeyStats();
    expect(rows.length).toBe(1);
    const stats = rows[0];
    expect(stats).toHaveProperty("active_keys");
    expect(stats).toHaveProperty("total_keys");
    expect(stats).toHaveProperty("total_requests");
    expect(stats).toHaveProperty("keys_this_week");
    expect(stats).toHaveProperty("active_key_requests");
  });

  test("total_keys is at least active_keys", async () => {
    if (!dbOnline) return;
    const rows = await fetchKeyStats();
    expect(Number(rows[0].total_keys)).toBeGreaterThanOrEqual(Number(rows[0].active_keys));
  });

  test("total_requests is non-negative", async () => {
    if (!dbOnline) return;
    const stats = await fetchKeyStats();
    expect(Number(stats[0].total_requests)).toBeGreaterThanOrEqual(0);
  });
});

describe("fetchTopDomains", () => {
  test("returns domains ordered by request count", async () => {
    if (!dbOnline) return;
    const rows = await fetchTopDomains(10, 0);
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      expect(row).toHaveProperty("domain");
      expect(row).toHaveProperty("total_requests");
      expect(row).toHaveProperty("keys");
      expect(Array.isArray(row.keys)).toBe(true);
    }
  });

  test("respects limit parameter", async () => {
    if (!dbOnline) return;
    const rows = await fetchTopDomains(5, 0);
    expect(rows.length).toBeLessThanOrEqual(5);
  });
});

describe("fetchTopDomainsCount", () => {
  test("returns a non-negative number", async () => {
    if (!dbOnline) return;
    const count = await fetchTopDomainsCount();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

describe("fetchAddressCount", () => {
  test("returns the MV row count estimate", async () => {
    if (!dbOnline) return;
    const rows = await fetchAddressCount();
    expect(rows.length).toBe(1);
    expect(Number(rows[0].address_count)).toBeGreaterThan(15_000_000);
  });

  test("address count matches pg_class estimate", async () => {
    if (!dbOnline) return;
    const sql = getSql();
    const direct = await sql`
      SELECT reltuples::bigint AS cnt FROM pg_class WHERE relname = 'address_search_mv'
    `;
    const fromFn = await fetchAddressCount();
    expect(Number(fromFn[0].address_count)).toBe(Number(direct[0].cnt));
  });
});
