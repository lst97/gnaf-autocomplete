import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb, getSql } from "../../src/db/client";
import { lookupAddressById } from "../../src/sql/address";

let dbOnline = false;
let samplePid: string | null = null;

beforeAll(async () => {
  try {
    const sql = getSql();
    const rows = await sql`SELECT address_detail_pid FROM address_search_mv LIMIT 1`;
    samplePid = rows[0]?.address_detail_pid ?? null;
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

describe("lookupAddressById", () => {
  test("returns result for a valid PID", async () => {
    if (!dbOnline || !samplePid) return;
    const rows = await lookupAddressById(samplePid);
    expect(rows.length).toBe(1);
    expect(rows[0].address_detail_pid).toBe(samplePid);
  });

  test("returns full address details", async () => {
    if (!dbOnline || !samplePid) return;
    const rows = await lookupAddressById(samplePid);
    const row = rows[0];
    expect(row).toHaveProperty("display");
    expect(row).toHaveProperty("street_lc");
    expect(row).toHaveProperty("locality_lc");
    expect(row).toHaveProperty("state");
    expect(row).toHaveProperty("postcode");
    expect(row).toHaveProperty("number_first");
    expect(row).toHaveProperty("confidence");
    expect(row).toHaveProperty("confidence_norm");
    expect(row).toHaveProperty("lat");
    expect(row).toHaveProperty("lon");
  });

  test("display is a non-empty string", async () => {
    if (!dbOnline || !samplePid) return;
    const rows = await lookupAddressById(samplePid);
    expect(typeof rows[0].display).toBe("string");
    expect(rows[0].display.length).toBeGreaterThan(0);
  });

  test("returns empty array for non-existent PID", async () => {
    if (!dbOnline) return;
    const rows = await lookupAddressById("NONEXISTENT_PID_12345");
    expect(rows.length).toBe(0);
  });

  test("state is a valid Australian state code", async () => {
    if (!dbOnline || !samplePid) return;
    const rows = await lookupAddressById(samplePid);
    const validStates = ["ACT", "NSW", "NT", "OT", "QLD", "SA", "TAS", "VIC", "WA"];
    expect(validStates).toContain(rows[0].state);
  });

  test("postcode is a 4-digit string", async () => {
    if (!dbOnline || !samplePid) return;
    const rows = await lookupAddressById(samplePid);
    expect(rows[0].postcode).toMatch(/^\d{4}$/);
  });

  test("lat and lon are valid coordinate strings", async () => {
    if (!dbOnline || !samplePid) return;
    const rows = await lookupAddressById(samplePid);
    const lat = parseFloat(rows[0].lat);
    const lon = parseFloat(rows[0].lon);
    expect(lat).toBeGreaterThan(-44);
    expect(lat).toBeLessThan(-10);
    expect(lon).toBeGreaterThan(113);
    expect(lon).toBeLessThan(154);
  });
});
