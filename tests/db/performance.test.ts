import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb, getSql } from "../../src/db/client";
import { routeQuery } from "../../src/db/router";
import { ensureCorrector, getCorrector, setCorrector } from "../../src/search/corrector";
import { Corrector } from "../../src/search/corrector";

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
    /* ignore */
  }
});

describe("performance: tier latencies", () => {
  test("tier1 (street prefix) completes in <50ms", async () => {
    if (!dbOnline) return;
    const r = routeQuery("1 main", null, null, 10);
    const start = performance.now();
    const rows = await r.sql;
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
    expect(rows.length).toBeGreaterThan(0);
  }, 10000);

  test("tier0 (state+postcode) completes in <20ms", async () => {
    if (!dbOnline) return;
    const r = routeQuery("sydney", "NSW", "2000", 10);
    const start = performance.now();
    const rows = await r.sql;
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(20);
    expect(rows.length).toBeGreaterThan(0);
  }, 10000);

  test("tier0_locality (state+locality) completes in <20ms", async () => {
    if (!dbOnline) return;
    const r = routeQuery("main syd", "NSW", null, 10);
    const start = performance.now();
    const rows = await r.sql;
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(20);
    expect(rows.length).toBeGreaterThan(0);
  }, 10000);

  test("tier0_number (state+number) completes in <100ms", async () => {
    if (!dbOnline) return;
    const r = routeQuery("12 main", "NSW", null, 10);
    const start = performance.now();
    const rows = await r.sql;
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
    expect(rows.length).toBeGreaterThan(0);
  }, 10000);

  test("postcode tier completes in <20ms", async () => {
    if (!dbOnline) return;
    const r = routeQuery("2000", null, null, 10);
    const start = performance.now();
    const rows = await r.sql;
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(20);
    expect(rows.length).toBeGreaterThan(0);
  }, 10000);

  test("tier4 (multi-word trigram) completes in <200ms", async () => {
    if (!dbOnline) return;
    // Use a query that definitely routes to tier4 (no alpha prefix extractable)
    const r = routeQuery("845 4d", null, null, 10);
    const start = performance.now();
    const rows = await r.sql;
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  }, 10000);
});

describe("performance: corrector dictionary size", () => {
  test("10000-entry corrector lookup completes in <50ms", () => {
    const c = new Corrector();
    for (let i = 0; i < 10000; i++) {
      c.addStreet(`streetname${i}`, i);
    }
    const start = performance.now();
    c.correctStreet("streername");
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
