import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb, getSql } from "../../src/db/client";
import {
  tier0LocalityQuery,
  tier0NumberQuery,
  tier0Query,
  tier1StreetQuery,
  tier2TrigramQuery,
  tier4MultiWordQuery,
  tierPostcodeQuery,
} from "../../src/db/queries";

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

async function expectResults(promise: Promise<unknown[]>) {
  const rows = await promise;
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThanOrEqual(10);
  for (const row of rows) {
    expect(row).toHaveProperty("address_detail_pid");
    expect(row).toHaveProperty("display");
    expect(row).toHaveProperty("state");
    expect(row).toHaveProperty("postcode");
  }
}

describe("tier0Query — state+postcode", () => {
  test("returns results for NSW 2000", async () => {
    if (!dbOnline) return;
    await expectResults(tier0Query("NSW", "2000", 10));
  });

  test("filters by state only when postcode is null", async () => {
    if (!dbOnline) return;
    const rows = await tier0Query("NSW", null, 10);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.state).toBe("NSW");
    }
  });

  test("returns results for VIC 3000", async () => {
    if (!dbOnline) return;
    await expectResults(tier0Query("VIC", "3000", 10));
  });

  test("respects limit parameter", async () => {
    if (!dbOnline) return;
    const rows = await tier0Query("NSW", "2000", 3);
    expect(rows.length).toBe(3);
  });

  test("respects offset parameter", async () => {
    if (!dbOnline) return;
    const first = await tier0Query("NSW", "2000", 3, 0);
    const second = await tier0Query("NSW", "2000", 3, 3);
    expect(first.length).toBe(3);
    expect(second.length).toBe(3);
    const firstIds = first.map((r: Record<string, unknown>) => r.address_detail_pid);
    const secondIds = second.map((r: Record<string, unknown>) => r.address_detail_pid);
    expect(firstIds).not.toEqual(secondIds);
  });
});

describe("tier0NumberQuery — state+number", () => {
  test("returns results for NSW number 1", async () => {
    if (!dbOnline) return;
    const rows = await tier0NumberQuery("NSW", 1, 10);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.state).toBe("NSW");
    }
  });
});

describe("tier0LocalityQuery — state+locality prefix", () => {
  test("returns results for NSW + 'syd'", async () => {
    if (!dbOnline) return;
    const rows = await tier0LocalityQuery("NSW", "syd", 10);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.state).toBe("NSW");
      expect(row.locality.toLowerCase()).toStartWith("syd");
    }
  });

  test("returns results for VIC + 'mel'", async () => {
    if (!dbOnline) return;
    const rows = await tier0LocalityQuery("VIC", "mel", 10);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.state).toBe("VIC");
      expect(row.locality.toLowerCase()).toStartWith("mel");
    }
  });
});

describe("tier1StreetQuery — street prefix", () => {
  test("returns results for 'main' street prefix", async () => {
    if (!dbOnline) return;
    const rows = await tier1StreetQuery("main", null, null, 10);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.display.toLowerCase()).toMatch(/\bmain/);
    }
  });

  test("filtered by state NSW", async () => {
    if (!dbOnline) return;
    const rows = await tier1StreetQuery("main", "NSW", null, 10);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.state).toBe("NSW");
    }
  });

  test("with number_first boost", async () => {
    if (!dbOnline) return;
    const rows = await tier1StreetQuery("main", null, null, 10, 0, 12);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("single-char prefix 'y' returns results", async () => {
    if (!dbOnline) return;
    const rows = await tier1StreetQuery("y", null, null, 10);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("flat type ahead boost (unit/flat/apt)", async () => {
    if (!dbOnline) return;
    const rows = await tier1StreetQuery("fortuna", null, null, 10, 0, null, true);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("tier2TrigramQuery — single-word fuzzy", () => {
  test("returns results for 'melbourne'", async () => {
    if (!dbOnline) return;
    const rows = await tier2TrigramQuery("melbourne", null, null, 10);
    expect(rows.length).toBeGreaterThan(0);
  }, 15000);

  test("returns results for 'townsville'", async () => {
    if (!dbOnline) return;
    const rows = await tier2TrigramQuery("townsville", null, null, 10);
    expect(rows.length).toBeGreaterThan(0);
  }, 15000);

  test("returns results for 'geelong'", async () => {
    if (!dbOnline) return;
    const rows = await tier2TrigramQuery("geelong", null, null, 10);
    expect(rows.length).toBeGreaterThan(0);
  }, 15000);

  test("filtered by state", async () => {
    if (!dbOnline) return;
    const rows = await tier2TrigramQuery("melbourne", "VIC", null, 10);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.state).toBe("VIC");
    }
  }, 15000);

  test("returns distinct display values", async () => {
    if (!dbOnline) return;
    const rows = await tier2TrigramQuery("melbourne", null, null, 20);
    const displays = rows.map((r: Record<string, unknown>) => r.display);
    expect(new Set(displays).size).toBe(displays.length);
  }, 15000);
});

describe("tier4MultiWordQuery — multi-word fuzzy", () => {
  test("returns results for two words", async () => {
    if (!dbOnline) return;
    const rows = await tier4MultiWordQuery("main street", null, null, 10);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("filtered by state", async () => {
    if (!dbOnline) return;
    const rows = await tier4MultiWordQuery("main street", "VIC", null, 10);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("works with three words", async () => {
    if (!dbOnline) return;
    const rows = await tier4MultiWordQuery("12 main sydney", null, null, 10);
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });
});

describe("tierPostcodeQuery — numeric postcode", () => {
  test("returns results for exact 4-digit postcode 2000", async () => {
    if (!dbOnline) return;
    const rows = await tierPostcodeQuery("2000", 10);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.postcode).toBe("2000");
    }
  });

  test("returns results for 3-digit prefix 20", async () => {
    if (!dbOnline) return;
    const rows = await tierPostcodeQuery("20", 10);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.postcode).toStartWith("20");
    }
  });

  test("respects limit for exact postcode", async () => {
    if (!dbOnline) return;
    const rows = await tierPostcodeQuery("2000", 5);
    expect(rows.length).toBe(5);
  });

  test("respects offset", async () => {
    if (!dbOnline) return;
    const first = await tierPostcodeQuery("2000", 5, 0);
    const second = await tierPostcodeQuery("2000", 5, 5);
    expect(first.length).toBe(5);
    expect(second.length).toBe(5);
    const firstIds = first.map((r: Record<string, unknown>) => r.address_detail_pid);
    const secondIds = second.map((r: Record<string, unknown>) => r.address_detail_pid);
    expect(firstIds).not.toEqual(secondIds);
  });
});

describe("tier1StreetQuery — edge cases", () => {
  test("flat number boost does not throw", async () => {
    if (!dbOnline) return;
    const rows = await tier1StreetQuery("fortuna", null, null, 10, 0, null, true, null, 2);
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });

  test("street type boost does not throw", async () => {
    if (!dbOnline) return;
    const rows = await tier1StreetQuery("main", null, null, 10, 0, null, false, null, null, "st");
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });
});
