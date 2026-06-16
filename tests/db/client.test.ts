import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb, getReadWriteSql, getSql } from "../../src/db/client";

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

describe("getSql", () => {
  test("returns a working database connection", async () => {
    if (!dbOnline) return;
    const sql = getSql();
    const result = await sql`SELECT 1 AS ok`;
    expect(result[0]?.ok).toBe(1);
  });

  test("returns the same singleton on repeated calls", () => {
    if (!dbOnline) return;
    const a = getSql();
    const b = getSql();
    expect(a).toBe(b);
  });

  test("can query pg_class for row estimates", async () => {
    if (!dbOnline) return;
    const sql = getSql();
    const result = await sql`
      SELECT reltuples::bigint AS cnt FROM pg_class WHERE relname = 'address_search_mv'
    `;
    expect(Number(result[0]?.cnt)).toBeGreaterThan(0);
  });
});

describe("getReadWriteSql", () => {
  test("returns a working read-write connection", async () => {
    if (!dbOnline) return;
    const sql = getReadWriteSql();
    const result = await sql`SELECT 1 AS ok`;
    expect(result[0]?.ok).toBe(1);
  });

  test("returns the same singleton on repeated calls", () => {
    if (!dbOnline) return;
    const a = getReadWriteSql();
    const b = getReadWriteSql();
    expect(a).toBe(b);
  });
});

describe("closeDb", () => {
  test("can be called multiple times without throwing", async () => {
    if (!dbOnline) return;
    await closeDb();
    await closeDb();
    const sql = getSql();
    const result = await sql`SELECT 1 AS ok`;
    expect(result[0]?.ok).toBe(1);
  });
});
