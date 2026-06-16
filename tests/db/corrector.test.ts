import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb } from "../../src/db/client";
import { fetchLocalities, fetchStreetNames } from "../../src/sql/corrector";

let dbOnline = false;

beforeAll(async () => {
  try {
    await fetchStreetNames();
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

describe("fetchStreetNames", () => {
  test("returns an array of street names with counts", async () => {
    if (!dbOnline) return;
    const rows = await fetchStreetNames();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows.slice(0, 10)) {
      expect(row).toHaveProperty("name");
      expect(row).toHaveProperty("n");
      expect(typeof row.name).toBe("string");
      expect(row.name.length).toBeGreaterThan(0);
      expect(Number(row.n)).toBeGreaterThan(0);
    }
  });

  test("contains common street names like 'main'", async () => {
    if (!dbOnline) return;
    const rows = await fetchStreetNames();
    const names = rows.map((r) => r.name);
    expect(names).toContain("main");
  });

  test("returns more than 100K unique street names", async () => {
    if (!dbOnline) return;
    const rows = await fetchStreetNames();
    expect(rows.length).toBeGreaterThan(100_000);
  });

  test("names are lowercase", async () => {
    if (!dbOnline) return;
    const rows = await fetchStreetNames();
    for (const row of rows.slice(0, 100)) {
      expect(row.name).toBe(row.name.toLowerCase());
    }
  });
});

describe("fetchLocalities", () => {
  test("returns an array of locality names with counts", async () => {
    if (!dbOnline) return;
    const rows = await fetchLocalities();
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows.slice(0, 10)) {
      expect(row).toHaveProperty("name");
      expect(row).toHaveProperty("n");
      expect(typeof row.name).toBe("string");
      expect(row.name.length).toBeGreaterThan(1);
      expect(Number(row.n)).toBeGreaterThan(0);
    }
  });

  test("contains common localities like 'sydney'", async () => {
    if (!dbOnline) return;
    const rows = await fetchLocalities();
    const names = rows.map((r) => r.name);
    expect(names).toContain("sydney");
  });

  test("returns unique locality names (10K+)", async () => {
    if (!dbOnline) return;
    const rows = await fetchLocalities();
    expect(rows.length).toBeGreaterThan(10_000);
  });

  test("names are lowercase", async () => {
    if (!dbOnline) return;
    const rows = await fetchLocalities();
    for (const row of rows.slice(0, 100)) {
      expect(row.name).toBe(row.name.toLowerCase());
    }
  });
});
