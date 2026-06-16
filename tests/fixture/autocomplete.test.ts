import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const FIXTURE_PATH = join(import.meta.dirname, "..", "fixtures", "addresses.json");

interface AddressFixture {
  metadata: { totalAddresses: number };
  addresses: Array<{
    id: string;
    display: string;
    components: Record<string, string | null>;
    lat: number | null;
    lon: number | null;
    confidence: number | null;
  }>;
}

let fixture: AddressFixture | null = null;

function loadFixture(): AddressFixture {
  if (fixture) return fixture;
  fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as AddressFixture;
  return fixture;
}

describe("fixture metadata", () => {
  test("fixture file loads and has 1000 records", () => {
    const f = loadFixture();
    expect(f.addresses.length).toBe(1000);
  });

  test("all addresses have a display string", () => {
    const f = loadFixture();
    for (const addr of f.addresses) expect(addr.display).toBeTruthy();
  });

  test("all addresses have a state", () => {
    const f = loadFixture();
    for (const addr of f.addresses) expect(addr.components.state).toBeTruthy();
  });

  test("all addresses have a street_name", () => {
    const f = loadFixture();
    for (const addr of f.addresses) expect(addr.components.street_name).toBeTruthy();
  });

  test("addresses span multiple states", () => {
    const f = loadFixture();
    const states = new Set(f.addresses.map(a => a.components.state));
    expect(states.size).toBeGreaterThanOrEqual(3);
  });

  test("includes 1-char street names", () => {
    const f = loadFixture();
    const names = f.addresses.map(a => (a.components.street_name || "").toLowerCase());
    expect(names.filter(n => n.length === 1).length).toBeGreaterThanOrEqual(3);
  });

  test("includes conflict names (street types / flat types as names)", () => {
    const f = loadFixture();
    const names = f.addresses.map(a => (a.components.street_name || "").toLowerCase());
    const conflicts = names.filter(n =>
      ["close", "lane", "court", "avenue", "crescent", "grove", "flat", "house", "parade", "carpark"].includes(n)
    );
    expect(conflicts.length).toBeGreaterThanOrEqual(3);
  });

  test("includes corrector target names", () => {
    const f = loadFixture();
    const names = f.addresses.map(a => (a.components.street_name || "").toLowerCase());
    const targets = names.filter(n =>
      ["gresford", "sydney", "wantirna", "strathmore", "brighton", "yarralumla"].includes(n)
    );
    expect(targets.length).toBeGreaterThanOrEqual(2);
  });
});
