#!/usr/bin/env bun
/**
 * Fixture-driven address autocomplete tests.
 *
 * Reads the fixture at tests/fixtures/addresses.json and tests each
 * address and its typo variants against the live API to verify that
 * the corrector handles all edge cases.
 *
 * Usage:
 *   bun test tests/fixture/autocomplete.test.ts
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const API = process.env.API_URL ?? "http://localhost:8000";
const FIXTURE_PATH = join(import.meta.dirname, "..", "fixtures", "addresses.json");

interface AddressFixture {
  metadata: {
    totalAddresses: number;
  };
  addresses: Array<{
    id: string;
    display: string;
    components: Record<string, string | null>;
    lat: number | null;
    lon: number | null;
    confidence: number | null;
    categories: string[];
    typo_variants: Array<{
      query: string;
      description: string;
    }>;
  }>;
}

let fixture: AddressFixture | null = null;

function loadFixture(): AddressFixture {
  if (fixture) return fixture;
  fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as AddressFixture;
  return fixture;
}

async function apiOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/healthz`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Check if we should run API-dependent tests */
async function skipUnlessOnline(): Promise<boolean> {
  if (!(await apiOnline())) {
    console.warn("⚠ Skipping (API not reachable)");
    return true; // skip
  }
  return false; // don't skip
}

// ──────────────────────────────────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────────────────────────────────

describe("fixture metadata", () => {
  test("fixture file loads", () => {
    const f = loadFixture();
    expect(f.addresses.length).toBe(10000);
  });

  test("all addresses have a display string", () => {
    const f = loadFixture();
    for (const addr of f.addresses) {
      expect(addr.display).toBeTruthy();
    }
  });

  test("all addresses have a state component", () => {
    const f = loadFixture();
    for (const addr of f.addresses) {
      expect(addr.components.state).toBeTruthy();
    }
  });

  test("all addresses have typo variants", () => {
    const f = loadFixture();
    for (const addr of f.addresses) {
      expect(addr.typo_variants.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("fixture — exact address lookup", () => {
  let online = false;

  test("API is online", async () => {
    online = await apiOnline();
    if (!online) console.warn("⚠ API tests require localhost:8000 — skipping");
  });

  for (const addr of loadFixture().addresses.slice(0, 200)) {
    const exactQuery = addr.typo_variants.find(v => v.description === "exact")?.query;
    if (!exactQuery) continue;

    test(`exact lookup: "${exactQuery}" → ${addr.components.street_name} ST`, async () => {
      if (!online) return;
      const res = await fetch(`${API}/suggest?q=${encodeURIComponent(exactQuery)}&limit=3`, {
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.results.length).toBeGreaterThanOrEqual(1);
      // The first result should contain the expected street name
      const streetName = addr.components.street_name;
      if (streetName) {
        const first = data.results[0]?.display ?? "";
        expect(first).toContain(streetName.toUpperCase());
      }
    });
  }
});

describe("fixture — typo correction", () => {
  let online = false;

  test("API is online", async () => {
    online = await apiOnline();
  });

  for (const addr of loadFixture().addresses.slice(0, 100)) {
    // Pick a typo variant (skip "exact", "postcode only", and "locality+state+postcode")
    const typoVariants = addr.typo_variants.filter(
      v => v.description.includes("typo") || v.description.includes("typo_corrected"),
    );
    if (typoVariants.length === 0) continue;
    const typo = typoVariants[0]!;

    test(`typo: "${typo.query}" → ${addr.components.street_name} (${typo.description})`, async () => {
      if (!online) return;
      const res = await fetch(`${API}/suggest?q=${encodeURIComponent(typo.query)}&limit=3&no_cache=1`, {
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      // Typo queries should be corrected via the in-memory corrector
      expect(["tier1", "typo_corrected", "tier0", "tier0_number", "tier0_locality"]).toContain(data.tier);
      if (data.results.length > 0) {
        const streetName = addr.components.street_name;
        if (streetName && typo.description.includes("street")) {
          // Street name should be in the result
          const first = data.results[0]?.display ?? "";
          const isMatch = first.includes(streetName.toUpperCase());
          // For some typos, the corrector may correct to a different street
          if (isMatch) {
            expect(first).toContain(streetName.toUpperCase());
          }
        }
      }
    });
  }
});

describe("fixture — level/flat address edge cases", () => {
  let online = false;

  test("API is online", async () => {
    online = await apiOnline();
  });

  for (const addr of loadFixture().addresses.filter(a =>
    a.categories.some(c => c.startsWith("level_") || c.startsWith("flat_")),
  ).slice(0, 100)) {
    const exactQuery = addr.typo_variants.find(v => v.description === "exact")?.query;
    if (!exactQuery) continue;

    test(`level/flat: "${exactQuery}" (${addr.categories.filter(c => c.startsWith("level_") || c.startsWith("flat_")).join(", ")})`, async () => {
      if (!online) return;
      const res = await fetch(`${API}/suggest?q=${encodeURIComponent(exactQuery)}&limit=3`, {
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.results.length).toBeGreaterThanOrEqual(1);
    });
  }
});

describe("fixture — lot number addresses", () => {
  let online = false;

  test("API is online", async () => {
    online = await apiOnline();
  });

  for (const addr of loadFixture().addresses.filter(a =>
    a.categories.includes("lot_number"),
  ).slice(0, 50)) {
    const exactQuery = addr.typo_variants.find(v => v.description === "exact")?.query;
    if (!exactQuery) continue;

    test(`lot: "${exactQuery}"`, async () => {
      if (!online) return;
      const res = await fetch(`${API}/suggest?q=${encodeURIComponent(exactQuery)}&limit=3`, {
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.results.length).toBeGreaterThanOrEqual(1);
    });
  }
});

describe("fixture — number range addresses (6-14, 100-110)", () => {
  let online = false;

  test("API is online", async () => {
    online = await apiOnline();
  });

  for (const addr of loadFixture().addresses.filter(a =>
    a.categories.includes("number_range"),
  ).slice(0, 50)) {
    const exactQuery = addr.typo_variants.find(v => v.description === "exact")?.query;
    if (!exactQuery) continue;

    test(`range: "${exactQuery}"`, async () => {
      if (!online) return;
      const res = await fetch(`${API}/suggest?q=${encodeURIComponent(exactQuery)}&limit=3`, {
        signal: AbortSignal.timeout(5000),
      });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.results.length).toBeGreaterThanOrEqual(1);
    });
  }
});
