import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb, getReadWriteSql, getSql } from "../../src/db/client";
import { insertApiKey } from "../../src/sql/keys";
import { resetKeyWindow, touchKey } from "../../src/lib/touch-key";
import { hashKey } from "../../src/lib/key-hash";

let dbOnline = false;
let hasExpiresColumn = false;
let testDomain: string;
let testPrefix: string;
let skipTests = false;

beforeAll(async () => {
  try {
    const sql = getSql();
    await sql`SELECT 1`;
    dbOnline = true;
    testDomain = `touch-test-${Date.now()}.example.com`;
    testPrefix = `touch_${Date.now().toString(36).slice(0, 6)}`;
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'api_keys' AND column_name = 'expires_at'
    `;
    hasExpiresColumn = cols.length > 0;
    if (!hasExpiresColumn) {
      skipTests = true;
    } else {
      await insertApiKey(
        testPrefix,
        hashKey("gnaf_pk_touch_test_key"),
        testDomain,
        `tok_${Date.now()}`,
        new Date(),
      );
    }
  } catch {
    dbOnline = false;
  }
});

afterAll(async () => {
  try {
    if (dbOnline && hasExpiresColumn) {
      const rw = getReadWriteSql();
      await rw`DELETE FROM api_keys WHERE prefix = ${testPrefix}`;
    }
    await closeDb();
  } catch {
    // ignore
  }
});

describe("touchKey", () => {
  test("increments rl_window_count", async () => {
    if (!dbOnline || skipTests || !testPrefix) return;
    await touchKey(testPrefix, new Date());
    const sql = getSql();
    const rows = await sql`
      SELECT rl_window_count, last_used_at FROM api_keys WHERE prefix = ${testPrefix}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].rl_window_count).toBe(1);
    expect(rows[0].last_used_at).toBeInstanceOf(Date);
  });

  test("increments again on second touch", async () => {
    if (!dbOnline || skipTests || !testPrefix) return;
    await touchKey(testPrefix, new Date());
    const sql = getSql();
    const rows = await sql`
      SELECT rl_window_count FROM api_keys WHERE prefix = ${testPrefix}
    `;
    expect(rows[0].rl_window_count).toBe(2);
  });
});

describe("resetKeyWindow", () => {
  test("resets window with new start time and count=1", async () => {
    if (!dbOnline || skipTests || !testPrefix) return;
    const now = new Date();
    await resetKeyWindow(testPrefix, now);
    const sql = getSql();
    const rows = await sql`
      SELECT rl_window_start, rl_window_count, last_used_at
      FROM api_keys WHERE prefix = ${testPrefix}
    `;
    expect(rows[0].rl_window_count).toBe(1);
    expect(rows[0].rl_window_start).toBeInstanceOf(Date);
    expect(rows[0].last_used_at.getTime()).toBeGreaterThanOrEqual(now.getTime() - 100);
  });
});
