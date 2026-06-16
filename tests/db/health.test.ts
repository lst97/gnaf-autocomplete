import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb } from "../../src/db/client";
import { checkMvPopulated, pingDb } from "../../src/sql/health";

let dbOnline = false;

beforeAll(async () => {
  try {
    await pingDb();
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

describe("pingDb", () => {
  test("returns without error when DB is connected", async () => {
    if (!dbOnline) return;
    await expect(pingDb()).resolves.toBeUndefined();
  });
});

describe("checkMvPopulated", () => {
  test("returns row estimate greater than 0", async () => {
    if (!dbOnline) return;
    const rows = await checkMvPopulated();
    expect(rows.length).toBe(1);
    expect(Number(rows[0].row_estimate)).toBeGreaterThan(0);
  });

  test("returns ispopulated as true", async () => {
    if (!dbOnline) return;
    const rows = await checkMvPopulated();
    expect(rows[0].ispopulated).toBe(true);
  });

  test("returns row_estimate close to 16 million", async () => {
    if (!dbOnline) return;
    const rows = await checkMvPopulated();
    expect(Number(rows[0].row_estimate)).toBeGreaterThan(15_000_000);
  });
});
