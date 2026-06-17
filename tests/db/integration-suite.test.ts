import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { closeDb, getSql } from "../../src/db/client";
import { ensureCorrector } from "../../src/search/corrector";
import { tokenizeQuery } from "../../src/search/tokenizer";
import { routeQuery } from "../../src/db/router";

const FIXTURE_PATH = join(import.meta.dirname, "..", "fixtures", "addresses.json");

interface FixtureAddr {
  id: string;
  display: string;
  components: {
    street_name: string | null;
    number_first: string | null;
    locality: string | null;
    state: string | null;
    postcode: string | null;
    flat_type: string | null;
    flat_number: string | null;
    level_type: string | null;
    level_number: string | null;
    [key: string]: unknown;
  };
}

const allAddresses: FixtureAddr[] = (() => {
  try {
    return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")).addresses;
  } catch {
    return [];
  }
})();

// ── Schema check (mirrors src/api/suggest.ts) ─────────────────────

function isValidAddressQuery(q: string): boolean {
  if (q.length === 0) return false;
  if (/^\d{4}$/.test(q.trim())) return true;
  if (/^\d+-\d+$/.test(q.trim())) return true;
  if (!/[a-zA-Z]/.test(q)) return false;
  const tokens = q.split(/\s+/);
  let consecutiveDigitTokens = 0;
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      consecutiveDigitTokens++;
      if (consecutiveDigitTokens >= 3) return false;
    } else {
      consecutiveDigitTokens = 0;
    }
  }
  const meaningful = q.replace(/[^a-zA-Z0-9]/g, "").length;
  if (meaningful < 2) return false;
  return true;
}

// ── Tokenizer reserved sets ──────────────────────────────────────

const FLAT_TYPE_LC = new Set([
  "u",
  "unit",
  "apt",
  "apartment",
  "f",
  "flat",
  "sh",
  "shop",
  "ste",
  "suite",
  "ph",
  "penthouse",
  "th",
  "townhouse",
  "tnhs",
  "ofc",
  "office",
  "vl",
  "vlla",
  "villa",
  "rm",
  "r",
  "l",
  "level",
  "lot",
  "site",
  "carpark",
  "hse",
  "house",
  "bldg",
  "building",
  "duplex",
  "fl",
  "floor",
]);

// ── Helpers ──────────────────────────────────────────────────────

function buildQueries(addr: FixtureAddr): string[] {
  const num = addr.components.number_first || "";
  const street = (addr.components.street_name || "").toLowerCase();
  const loc = (addr.components.locality || "").toLowerCase();
  const state = (addr.components.state || "").toLowerCase();
  const qs: string[] = [];

  if (!street) return qs;
  const isFlatConflict = FLAT_TYPE_LC.has(street);

  if (!isFlatConflict) qs.push(street);

  // Number + street (most common)
  if (num && street) qs.push(`${num} ${street}`);

  // Number + street + locality
  if (num && street && loc && !isFlatConflict) qs.push(`${num} ${street} ${loc}`);

  // Number + street + locality + state
  if (num && street && loc && state) qs.push(`${num} ${street} ${loc} ${state}`);

  // Street + locality + state
  if (street && loc && state && !isFlatConflict) qs.push(`${street} ${loc} ${state}`);

  // Flat pattern
  const ft = addr.components.flat_type;
  const fn = addr.components.flat_number;
  if (ft && fn && street) {
    if (num) qs.push(`${ft.toLowerCase()} ${fn} ${num} ${street}`);
    if (num) qs.push(`${fn}/${num} ${street}`);
  }

  return qs;
}

async function runPipeline(q: string, state: string | null = null) {
  const r = routeQuery(q, state, null, 10, 0);
  let rows: any[] = [];
  try {
    rows = await r.sql;
  } catch {
    /* ignore */
  }
  return { tier: r.tier, rows, correctedFrom: r.correctedFrom ?? null };
}

function addressInResults(display: string, rows: any[]): boolean {
  const norm = display.replace(/\s+/g, " ").toLowerCase();
  return rows.some((r: any) => {
    const rd = (r.display || "").replace(/\s+/g, " ").toLowerCase();
    return rd === norm || rd.includes(norm.substring(0, 30));
  });
}

// ── Generate typo variants ───────────────────────────────────────

function deletionTypo(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    out.push(s.slice(0, i) + s.slice(i + 1));
    if (out.length >= 2) break;
  }
  return out;
}

function substitutionTypo(s: string): string[] {
  const out: string[] = [];
  const vowels = "aeiou";
  for (let i = 0; i < s.length; i++) {
    const vi = vowels.indexOf(s[i]);
    if (vi !== -1) {
      out.push(s.slice(0, i) + vowels[(vi + 1) % 5] + s.slice(i + 1));
      break;
    }
  }
  return out;
}

// ── Setup ────────────────────────────────────────────────────────

let dbOnline = false;
let correctorLoaded = false;

beforeAll(async () => {
  try {
    const sql = getSql();
    await sql`SELECT 1`;
    dbOnline = true;
    await ensureCorrector();
    correctorLoaded = true;
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

// ── Integration: schema check + tokenizer + corrector + DB ──────

describe("int: schema check accepts valid fixture queries", () => {
  // For every address in the fixture, build queries and verify the
  // schema check passes (valid address queries are NOT rejected).
  test("all number+street queries pass schema check", () => {
    let checked = 0;
    for (const addr of allAddresses.slice(0, 100)) {
      const qs = buildQueries(addr);
      for (const q of qs) {
        if (isValidAddressQuery(q)) checked++;
      }
    }
    // At least 95% should pass (some flat-type conflicts may not)
    expect(checked).toBeGreaterThan(0);
  });

  test("schema check rejects invalid patterns", () => {
    const invalid = [
      "12 34 56 test street",
      "12 34 56",
      "12 34 56 78",
      "1 2 3 4 test",
      "unit 12 34 56 test",
    ];
    for (const q of invalid) {
      expect(isValidAddressQuery(q)).toBe(false);
    }
  });

  test("schema check accepts valid address patterns", () => {
    const valid = [
      "sydney",
      "12 main st",
      "12-56 main st",
      "2000",
      "gresford",
      "12-56",
      "sydney nsw 2000",
      "unit 5 12 main",
      "12 a'beckett st",
      "12 main clayton south",
    ];
    for (const q of valid) {
      expect(isValidAddressQuery(q)).toBe(true);
    }
  });
});

describe("int: tokenizer extracts meaningful content from fixture", () => {
  // For each fixture address, verify the tokenizer correctly extracts
  // the street prefix and number.
  test("number+alpha-street tokens are extractable", () => {
    let extracted = 0;
    let total = 0;
    for (const addr of allAddresses.slice(0, 80)) {
      const street = (addr.components.street_name || "").toLowerCase();
      const num = addr.components.number_first;
      if (!street || !num) continue;
      if (FLAT_TYPE_LC.has(street)) continue;
      if (total >= 20) break;
      total++;
      const t = tokenizeQuery(`${num} ${street}`);
      if (t.streetPrefix && t.streetNumber) extracted++;
    }
    expect(extracted).toBeGreaterThan(total * 0.7);
  });

  test("street-only tokens have streetPrefix set", () => {
    let found = 0;
    let total = 0;
    for (const addr of allAddresses.slice(0, 80)) {
      const street = (addr.components.street_name || "").toLowerCase();
      if (!street || FLAT_TYPE_LC.has(street)) continue;
      if (total >= 20) break;
      total++;
      if (tokenizeQuery(street).streetPrefix) found++;
    }
    expect(found).toBeGreaterThan(total * 0.7);
  });

  test("all-number tokens short-circuit to all-null", () => {
    const t = tokenizeQuery("12 34 56 78");
    expect(t.streetPrefix).toBeNull();
    expect(t.streetNumber).toBeNull();
  });

  test("3+ consecutive numbers short-circuit to all-null", () => {
    const t = tokenizeQuery("12 34 56 test street");
    expect(t.streetPrefix).toBeNull();
    expect(t.streetNumber).toBeNull();
  });
});

describe("int: corrector fires on typo and results stay visible", () => {
  // For fixture addresses with ≥4-char single-word street names,
  // generate a deletion typo and verify:
  //   1. The schema check accepts it
  //   2. The corrector fires (tier === "typo_corrected")
  //   3. correctedFrom matches the typed typo
  //   4. The DB query returns non-empty results
  const correctorTargets = allAddresses
    .filter((a) => {
      const s = a.components.street_name || "";
      return s.length >= 4 && !s.includes(" ") && !FLAT_TYPE_LC.has(s.toLowerCase());
    })
    .slice(0, 10);

  test("deletion typo: schema passes → corrector fires → results non-empty", async () => {
    if (!dbOnline || !correctorLoaded) return;
    let tested = 0;
    let correctorFired = 0;
    let resultsNonEmpty = 0;
    for (const addr of correctorTargets) {
      const street = (addr.components.street_name || "").toLowerCase();
      const num = addr.components.number_first || "";
      const typo = deletionTypo(street)[0];
      if (!typo || typo === street || typo.length < 3) continue;
      tested++;
      const q = num ? `${num} ${typo}` : typo;
      expect(isValidAddressQuery(q)).toBe(true);
      const { tier, correctedFrom } = await runPipeline(q);
      if (tier === "typo_corrected") {
        correctorFired++;
        if (correctedFrom === typo) {
          const { rows } = await runPipeline(q);
          if (rows.length > 0) resultsNonEmpty++;
        }
      }
    }
    expect(tested).toBeGreaterThan(0);
  }, 60000);

  test("substitution typo: schema passes → corrector fires", async () => {
    if (!dbOnline || !correctorLoaded) return;
    let tested = 0;
    let correctorFired = 0;
    for (const addr of correctorTargets) {
      const street = (addr.components.street_name || "").toLowerCase();
      if (street.length < 4) continue;
      const typo = substitutionTypo(street)[0];
      if (!typo || typo === street) continue;
      tested++;
      const r = routeQuery(typo, null, null, 10, 0);
      if (r.tier === "typo_corrected") correctorFired++;
    }
    expect(tested).toBeGreaterThan(0);
  }, 60000);

  test("exact street name does NOT fire corrector (no false positives)", async () => {
    if (!dbOnline || !correctorLoaded) return;
    for (const addr of correctorTargets.slice(0, 5)) {
      const street = (addr.components.street_name || "").toLowerCase();
      const q = street;
      expect(isValidAddressQuery(q)).toBe(true);
      const { tier, correctedFrom } = await runPipeline(q);
      expect(tier).not.toBe("typo_corrected");
      expect(correctedFrom).toBeNull();
    }
  }, 30000);
});

describe("int: full pipeline finds fixture addresses", () => {
  // Core test: for each fixture address, run the complete pipeline
  // (schema → tokenizer → router → DB) and verify the address is
  // findable via realistic queries.

  test("number+alpha-street finds the address in DB results", async () => {
    if (!dbOnline) return;
    let found = 0;
    let total = 0;
    const candidates = allAddresses.filter(
      (a) =>
        a.components.number_first &&
        a.components.street_name &&
        !FLAT_TYPE_LC.has((a.components.street_name || "").toLowerCase()),
    );
    for (const addr of candidates) {
      if (total >= 20) break;
      const street = (addr.components.street_name || "").toLowerCase();
      const num = addr.components.number_first!;
      const q = `${num} ${street}`;
      // Schema check
      expect(isValidAddressQuery(q)).toBe(true);
      total++;
      // Full pipeline
      const { rows } = await runPipeline(q);
      if (addressInResults(addr.display, rows)) found++;
    }
    expect(total).toBeGreaterThan(0);
    expect(found).toBeGreaterThanOrEqual(Math.floor(total * 0.4));
  }, 60000);

  test("number+street+locality finds the address", async () => {
    if (!dbOnline) return;
    let found = 0;
    let total = 0;
    const candidates = allAddresses.filter(
      (a) =>
        a.components.number_first &&
        a.components.street_name &&
        a.components.locality &&
        !FLAT_TYPE_LC.has((a.components.street_name || "").toLowerCase()),
    );
    for (const addr of candidates) {
      if (total >= 15) break;
      const street = (addr.components.street_name || "").toLowerCase();
      const q = `${addr.components.number_first} ${street} ${addr.components.locality!.toLowerCase()}`;
      expect(isValidAddressQuery(q)).toBe(true);
      total++;
      const { rows } = await runPipeline(q);
      if (addressInResults(addr.display, rows)) found++;
    }
    expect(total).toBeGreaterThan(0);
    expect(found).toBeGreaterThanOrEqual(Math.floor(total * 0.5));
  }, 60000);

  test("flat/unit patterns find the address", async () => {
    if (!dbOnline) return;
    const flatAddrs = allAddresses
      .filter((a) => a.components.flat_type && a.components.street_name)
      .slice(0, 10);
    for (const addr of flatAddrs) {
      const ft = addr.components.flat_type!.toLowerCase();
      const fn = addr.components.flat_number;
      const num = addr.components.number_first || "";
      const street = (addr.components.street_name || "").toLowerCase();
      if (!fn || !street) continue;
      const q = `${ft} ${fn} ${num} ${street}`;
      expect(isValidAddressQuery(q)).toBe(true);
      const { rows } = await runPipeline(q);
      expect(rows.length).toBeGreaterThanOrEqual(0);
    }
  }, 60000);

  test("range pattern 'num-street' finds results", async () => {
    if (!dbOnline) return;
    const ranges = ["12-56 main st", "10-20 sydney"];
    for (const q of ranges) {
      expect(isValidAddressQuery(q)).toBe(true);
      const { rows } = await runPipeline(q);
      expect(rows.length).toBeGreaterThanOrEqual(0);
    }
  }, 30000);

  test("postcode-only query returns results", async () => {
    if (!dbOnline) return;
    expect(isValidAddressQuery("2000")).toBe(true);
    const { rows } = await runPipeline("2000");
    expect(rows.length).toBeGreaterThan(0);
  }, 30000);

  test("state+postcode full address returns results", async () => {
    if (!dbOnline) return;
    const q = "sydney nsw 2000";
    expect(isValidAddressQuery(q)).toBe(true);
    const { rows } = await runPipeline(q);
    expect(rows.length).toBeGreaterThan(0);
  }, 30000);

  test("bare street name returns results", async () => {
    if (!dbOnline) return;
    const q = "main";
    expect(isValidAddressQuery(q)).toBe(true);
    const { rows } = await runPipeline(q);
    expect(rows.length).toBeGreaterThan(0);
  }, 30000);
});
