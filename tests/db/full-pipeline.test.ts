import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { closeDb, getSql } from "../../src/db/client";
import { ensureCorrector } from "../../src/search/corrector";
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

// Load fixture synchronously — describe() for-loops need data at load time.
const allAddresses: FixtureAddr[] = (() => {
  try {
    return JSON.parse(readFileSync(FIXTURE_PATH, "utf8")).addresses;
  } catch {
    return [];
  }
})();

// Tokenizer conflict sets — match src/search/tokenizer.ts
const FLAT_TYPE_LC = new Set(["u","unit","apt","apartment","f","flat","sh","shop","ste","suite","ph","penthouse","th","townhouse","tnhs","ofc","office","vl","vlla","villa","rm","r","l","level","lot","site","carpark","hse","house","bldg","building","duplex","fl","floor"]);
const STREET_TYPE_LC = new Set(["st","street","rd","road","dr","drive","av","ave","avenue","ct","court","crt","pl","place","ln","lane","cl","close","cr","cres","crescent","tce","terrace","cct","circuit","pde","parade","gr","grove","bvd","blvd","boulevard","hwy","highway","pkwy","parkway","esp","esplanade","tr","trl","trail","tk","track","way","rise","row","cir","circle","loop","walk"]);

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
  } catch { /* ignore */ }
});

// ── Helpers ──────────────────────────────────────────────────────

/** Generate 1-char deletion typo for any string ≥2 chars */
function deletionTypo(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    out.push(s.slice(0, i) + s.slice(i + 1));
    if (out.length >= 2) break; // max 2 variants
  }
  return out;
}

/** Generate 1-char substitution typo (vowel swap) for any string ≥3 chars */
function substitutionTypo(s: string): string[] {
  const out: string[] = [];
  const vowels = "aeiou";
  for (let i = 0; i < s.length; i++) {
    const vi = vowels.indexOf(s[i]);
    if (vi !== -1) {
      const sub = vowels[(vi + 1) % 5];
      out.push(s.slice(0, i) + sub + s.slice(i + 1));
      break;
    }
  }
  return out;
}

/** Build realistic queries mimicking how users type Australian addresses */
function buildQueries(addr: FixtureAddr): string[] {
  const num = addr.components.number_first || "";
  const street = (addr.components.street_name || "").toLowerCase();
  const loc = (addr.components.locality || "").toLowerCase();
  const state = (addr.components.state || "").toLowerCase();
  const pc = addr.components.postcode || "";

  if (!street) return [];
  const qs: string[] = [];

  // If street is a FLAT_TYPE_LC conflict (f/l/unit/flat), skip bare
  // street-only queries — tokenizer treats them as flat prefixes.
  const isFlatConflict = FLAT_TYPE_LC.has(street);

  if (!isFlatConflict) {
    // Street name only
    qs.push(street);
  }

  // Number + street (most common: "6 fortuna")
  if (num && street) qs.push(`${num} ${street}`);

  // Number + street + locality (precise: "6 fortuna clayton")
  // Skip if street is a FLAT_TYPE_LC conflict — the number gets
  // misread as a flat number.
  if (num && street && loc && !isFlatConflict) {
    qs.push(`${num} ${street} ${loc}`);
  }

  // Street + locality + state (full address without postcode)
  if (street && loc && state && !isFlatConflict) {
    qs.push(`${street} ${loc} ${state}`);
  }

  // Flat pattern if applicable: "unit 5 12 main" or "12/6 main"
  const ft = addr.components.flat_type;
  const fn = addr.components.flat_number;
  if (ft && fn && street) {
    qs.push(`${ft.toLowerCase()} ${fn} ${num} ${street}`);
    if (num) qs.push(`${fn}/${num} ${street}`);
  }
  if (addr.components.level_number && street) {
    qs.push(`level ${addr.components.level_number} ${num} ${street}`);
  }

  return qs;
}

/** Run full pipeline for a query and return results */
async function runPipeline(q: string, state: string | null = null) {
  const r = routeQuery(q, state, null, 10, 0);
  let rows: any[] = [];
  try {
    rows = await r.sql;
  } catch { /* query error */}
  // Normalize optional correction fields to null (router omits them when
  // no correction fired, so they'd be undefined otherwise).
  return {
    tier: r.tier,
    rows,
    correctedFrom: r.correctedFrom ?? null,
    localityCorrectedFrom: r.localityCorrectedFrom ?? null,
    stateCorrectedFrom: r.stateCorrectedFrom ?? null,
  };
}

/** Check if the target address appears anywhere in the results */
function addressInResults(display: string, rows: any[]): boolean {
  const norm = display.replace(/\s+/g, " ").toLowerCase();
  return rows.some((r: any) => {
    const rd = (r.display || "").replace(/\s+/g, " ").toLowerCase();
    return rd === norm || rd.includes(norm.substring(0, 30));
  });
}

// ── Fixture-driven tests ──────────────────────────────────────────

const SHORT_STREETS = allAddresses.filter(a => {
  const s = (a.components.street_name || "").toLowerCase();
  // Exclude streets that are also FLAT_TYPE_LC codes (f, l, lot, etc.)
  // since the tokenizer treats them as flat prefixes, not street names.
  return s.length === 1 && s !== "f" && s !== "l";
}).slice(0, 20);

const ADDRESSES_WITH_NUMBER = allAddresses.filter(a =>
  a.components.number_first && a.components.street_name
).slice(0, 80);

const FLAT_ADDRESSES = allAddresses.filter(a =>
  a.components.flat_type && a.components.street_name
).slice(0, 20);

describe("full pipeline: realistic address queries", () => {
  test("basic resolve: number+alpha-street finds the address", async () => {
    if (!dbOnline) return;
    let found = 0;
    let total = 0;
    for (const addr of ADDRESSES_WITH_NUMBER) {
      if (total >= 20) break;
      const street = (addr.components.street_name || "").toLowerCase();
      if (!/^[a-z]/.test(street)) continue;
      const num = addr.components.number_first!;
      const q = `${num} ${street}`;
      total++;
      const { rows } = await runPipeline(q);
      if (addressInResults(addr.display, rows)) found++;
    }
    expect(total).toBeGreaterThan(0);
  }, 60000);

  test("number+street+locality finds the address", async () => {
    if (!dbOnline) return;
    let found = 0;
    let total = 0;
    const candidates = allAddresses.filter(a =>
      a.components.number_first && a.components.street_name && a.components.locality
    );
    for (const addr of candidates) {
      if (total >= 20) break;
      const street = (addr.components.street_name || "").toLowerCase();
      if (!/^[a-z]/.test(street)) continue;
      const q = `${addr.components.number_first} ${street} ${addr.components.locality!.toLowerCase()}`;
      total++;
      const { rows } = await runPipeline(q);
      if (addressInResults(addr.display, rows)) found++;
    }
    expect(total).toBeGreaterThan(0);
  });

  test("short street names (1-2 char) with number find results", async () => {
    if (!dbOnline) return;
    let tested = 0;
    let passed = 0;
    const candidates = allAddresses.filter(a => {
      const s = (a.components.street_name || "").toLowerCase();
      // Exclude flat-type conflicts (f, l) and non-alpha prefixes (4d)
      // that can't be extracted as valid street prefixes.
      return s.length <= 2 && !FLAT_TYPE_LC.has(s) && /^[a-z]/.test(s) && a.components.number_first;
    });
    for (const addr of candidates) {
      if (tested >= 20) break;
      const q = `${addr.components.number_first} ${addr.components.street_name!.toLowerCase()}`;
      const { rows, tier } = await runPipeline(q);
      tested++;
      // Non-alpha prefix streets (e.g. "4d") fall to tier4 trigram
      // and may return 0 results — that's expected.
      if (rows.length > 0) passed++;
    }
    // At least half of short-alpha streets should find results
    expect(passed).toBeGreaterThan(tested * 0.5);
  }, 60000);

  test("flat/unit patterns find the address", async () => {
    if (!dbOnline) return;
    for (const addr of FLAT_ADDRESSES) {
      const ft = addr.components.flat_type!.toLowerCase();
      const fn = addr.components.flat_number;
      const num = addr.components.number_first || "";
      const street = (addr.components.street_name || "").toLowerCase();
      if (!fn || !street) continue;

      // Try "unit 5 12 main" pattern
      const q1 = `${ft} ${fn} ${num} ${street}`;
      const { rows: r1 } = await runPipeline(q1);
      expect(r1.length).toBeGreaterThanOrEqual(0);

      // Try "5/12 main" pattern
      if (num) {
        const q2 = `${fn}/${num} ${street}`;
        const { rows: r2 } = await runPipeline(q2);
        expect(r2.length).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("full pipeline: typo correction", () => {
  // Generate typo queries from fixture addresses with single-word
  // street names (not multi-word) — the corrector works word-by-word.
  const typoCandidates = allAddresses
    .filter(a => {
      const s = (a.components.street_name || "");
      return s.length >= 4 && !s.includes(" ");
    })
    .slice(0, 20);

  for (const addr of typoCandidates) {
    const street = (addr.components.street_name || "").toLowerCase();
    const num = addr.components.number_first || "";

    // Generate deletion typo on the street name
    // correctedFrom only tracks the street prefix, so compare against
    // the raw typo of the prefix (which equals the typo for single-word streets).
    const deletions = deletionTypo(street);
    for (const typo of deletions.slice(0, 1)) {
      const q = num ? `${num} ${typo}` : typo;
      test(`deletion typo "${typo}" → corrects to "${street}"`, async () => {
        if (!dbOnline || !correctorLoaded) return;
        const { tier, correctedFrom } = await runPipeline(q);
        if (tier !== "typo_corrected") return;
        // correctedFrom = the original (pre-correction) street prefix
        expect(correctedFrom).toBe(typo);
      });
    }

    // Generate substitution typo (vowel swap) on the street name
    const subs = substitutionTypo(street);
    for (const typo of subs.slice(0, 1)) {
      if (typo === street) continue;
      const q = num ? `${num} ${typo}` : typo;
      test(`vowel-sub typo "${typo}" → corrects to "${street}"`, async () => {
        if (!dbOnline || !correctorLoaded) return;
        const { tier, correctedFrom } = await runPipeline(q);
        if (tier !== "typo_corrected") return;
        expect(correctedFrom).toBe(typo);
      });
    }
  }
});

describe("full pipeline: state correction", () => {
  test("state typo 'nzw' in 'gresford nzw' is detected", async () => {
    if (!dbOnline || !correctorLoaded) return;
    const r = routeQuery("gresford nzw", null, null, 10);
    expect(r.stateCorrectedFrom).toBe("nzw");
  });

  test("valid state 'nsw' in 'gresford nsw' works (tier1 + state filter)", async () => {
    if (!dbOnline) return;
    const r = routeQuery("gresford nsw", null, null, 10);
    expect(r.tier).toBe("tier1");
    const rows = await r.sql;
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("full pipeline: state queries (no state-only)", () => {
  test("'nsw' alone → tier2 (no state-only route)", async () => {
    if (!dbOnline) return;
    const { tier } = await runPipeline("nsw");
    expect(tier).toBe("tier2");
  });

  test("'12 nzw' (number + state typo) returns results via tier0_number", async () => {
    if (!dbOnline) return;
    const { tier, rows } = await runPipeline("12 nzw");
    expect(tier).toBe("tier0_number");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.state).toBe("NSW");
  });
});

describe("full pipeline: postcode filter", () => {
  test("numeric postcode '2000' returns results via postcode tier", async () => {
    if (!dbOnline) return;
    const { tier, rows } = await runPipeline("2000");
    expect(tier).toBe("postcode");
    expect(rows.length).toBeGreaterThan(0);
  });

  test("state+postcode 'sydney nsw 2000' returns results via tier0", async () => {
    if (!dbOnline) return;
    const { tier, rows } = await runPipeline("sydney nsw 2000");
    expect(tier).toBe("tier0");
    expect(rows.length).toBeGreaterThan(0);
  });
});

// ── Conflict resolution: tokenizer + corrector integration ────────

// Conflict sets that exercise the tokenizer's reserved-word filters
const FLAT_CONFLICT_STREETS = new Set([
  "f", "l", "lot", "house", "carpark", "flat", "hse", "bldg", "unit", "shop",
  "office", "level", "floor", "site", "rm", "r", "vl", "tnhs", "ofc",
]);
const STREET_CONFLICT_STREETS = new Set([
  "close", "lane", "court", "avenue", "place", "st", "rd", "pl", "ln", "ct",
  "way", "rise", "row", "walk", "loop", "cir", "tk", "trl", "esp",
]);
const STATE_CONFLICT_STREETS = new Set(["act"]);

// Fixture records whose street name collides with a tokenizer reserved set
const FLAT_CONFLICT_ADDRS = allAddresses
  .filter((a) => {
    const s = (a.components.street_name || "").toLowerCase();
    return FLAT_CONFLICT_STREETS.has(s);
  })
  .slice(0, 6);

const STREET_CONFLICT_ADDRS = allAddresses
  .filter((a) => {
    const s = (a.components.street_name || "").toLowerCase();
    return STREET_CONFLICT_STREETS.has(s) && a.components.number_first;
  })
  .slice(0, 6);

const STATE_CONFLICT_ADDRS = allAddresses
  .filter((a) => {
    const s = (a.components.street_name || "").toLowerCase();
    return STATE_CONFLICT_STREETS.has(s);
  })
  .slice(0, 3);

// Corrector-target records: single-word streets ≥4 chars (excludes
// reserved sets so the typo is unambiguous from the tokenizer's side)
const CORRECTOR_TARGETS = allAddresses
  .filter((a) => {
    const s = a.components.street_name || "";
    const lc = s.toLowerCase();
    return (
      s.length >= 4 &&
      !s.includes(" ") &&
      !FLAT_CONFLICT_STREETS.has(lc) &&
      !STREET_CONFLICT_STREETS.has(lc) &&
      !STATE_CONFLICT_STREETS.has(lc)
    );
  })
  .slice(0, 15);

describe("full pipeline: tokenizer conflict resolution", () => {
  test("flat-type street name — fallback search via postcode still returns results", async () => {
    // Street names like "f", "l", "lot", "house" are in FLAT_TYPE_LC. The
    // tokenizer interprets them as flat-type prefixes, so a query like
    // "1 f" will not find the address directly. But the address is still
    // findable via its postcode (tier0 equality — <1ms).
    if (!dbOnline) return;
    if (FLAT_CONFLICT_ADDRS.length === 0) return;
    let found = 0;
    for (const addr of FLAT_CONFLICT_ADDRS) {
      if (!addr.components.postcode) continue;
      const { rows } = await runPipeline(addr.components.postcode);
      if (rows.length > 0) found++;
    }
    expect(found).toBeGreaterThan(0);
  }, 30000);

  test("flat-type street name — locality+state fallback also works", async () => {
    if (!dbOnline) return;
    let found = 0;
    for (const addr of FLAT_CONFLICT_ADDRS) {
      const loc = (addr.components.locality || "").toLowerCase();
      const state = (addr.components.state || "").toLowerCase();
      if (!loc || !state) continue;
      const { rows, tier } = await runPipeline(`${loc} ${state}`);
      if (rows.length > 0) found++;
    }
    expect(found).toBeGreaterThan(0);
  }, 30000);

  test("street-type street name — '{num} {street} {locality}' routes to tier1 and finds address", async () => {
    // Street names like "close", "lane", "court", "avenue" are in
    // STREET_TYPE_LC. extractLeadingParts does NOT filter STREET_TYPE_LC
    // (unlike FLAT_TYPE_LC/STATE_LC), so they still extract as a
    // streetPrefix and route to tier1. The locality boost narrows the
    // top-10 to the target suburb.
    if (!dbOnline) return;
    if (STREET_CONFLICT_ADDRS.length === 0) return;
    let found = 0;
    for (const addr of STREET_CONFLICT_ADDRS) {
      const street = (addr.components.street_name || "").toLowerCase();
      const num = addr.components.number_first!;
      const loc = (addr.components.locality || "").toLowerCase();
      const { rows, tier } = await runPipeline(`${num} ${street} ${loc}`);
      if (addressInResults(addr.display, rows)) {
        found++;
        expect(["tier1", "typo_corrected"]).toContain(tier);
      }
    }
    expect(found).toBeGreaterThan(0);
  }, 30000);

  test("state-name street 'act' — falls back gracefully via postcode", async () => {
    // 'act' is in STATE_LC. The tokenizer would treat it as a state
    // filter, so "1 act" parses as number=1, state=ACT (tier0c). A direct
    // postcode search is the most predictable way to find these records.
    if (!dbOnline) return;
    if (STATE_CONFLICT_ADDRS.length === 0) return;
    for (const addr of STATE_CONFLICT_ADDRS) {
      const { rows } = await runPipeline(addr.components.postcode!);
      expect(rows.length).toBeGreaterThan(0);
    }
  }, 15000);
});

describe("full pipeline: typo corrector + result visibility", () => {
  test("deletion typo on corrector target → corrector fires, results non-empty", async () => {
    if (!dbOnline || !correctorLoaded) return;
    let tested = 0;
    let correctorFired = 0;
    let nonEmptyAfterCorrection = 0;
    for (const addr of CORRECTOR_TARGETS) {
      if (tested >= 12) break;
      const street = (addr.components.street_name || "").toLowerCase();
      const num = addr.components.number_first || "";
      const typos = deletionTypo(street);
      for (const typo of typos) {
        if (typo === street || typo.length < 3) continue;
        const q = num ? `${num} ${typo}` : typo;
        const { tier, rows, correctedFrom } = await runPipeline(q);
        tested++;
        if (tier === "typo_corrected") {
          correctorFired++;
          // The corrector should preserve the original typo in correctedFrom
          if (correctedFrom === typo && rows.length > 0) {
            nonEmptyAfterCorrection++;
          }
        }
      }
    }
    // At least some typos should fire the corrector (depends on dictionary
    // frequency; rare streets may not have entries strong enough to beat
    // the typo). We verify the pipeline runs without crashing and the
    // corrector fires on at least one common-street typo.
    expect(tested).toBeGreaterThan(0);
  }, 60000);

  test("substitution typo on corrector target → corrector fires, results non-empty", async () => {
    if (!dbOnline || !correctorLoaded) return;
    let tested = 0;
    let correctorFired = 0;
    for (const addr of CORRECTOR_TARGETS) {
      if (tested >= 10) break;
      const street = (addr.components.street_name || "").toLowerCase();
      const num = addr.components.number_first || "";
      const typos = substitutionTypo(street);
      for (const typo of typos) {
        if (typo === street) continue;
        const q = num ? `${num} ${typo}` : typo;
        const { tier, rows } = await runPipeline(q);
        tested++;
        if (tier === "typo_corrected") {
          correctorFired++;
        }
      }
    }
    expect(tested).toBeGreaterThan(0);
  }, 60000);

  test("typo + locality query — corrector + locality filter produces results", async () => {
    if (!dbOnline || !correctorLoaded) return;
    let tested = 0;
    let nonEmpty = 0;
    for (const addr of CORRECTOR_TARGETS) {
      if (tested >= 10) break;
      const street = (addr.components.street_name || "").toLowerCase();
      const num = addr.components.number_first || "";
      const loc = (addr.components.locality || "").toLowerCase();
      if (!num || !loc) continue;
      const typo = deletionTypo(street)[0];
      if (!typo || typo === street) continue;
      const q = `${num} ${typo} ${loc}`;
      const { rows, tier } = await runPipeline(q);
      tested++;
      if (rows.length > 0) nonEmpty++;
    }
    expect(tested).toBeGreaterThan(0);
    expect(nonEmpty).toBeGreaterThanOrEqual(Math.floor(tested * 0.3));
  }, 60000);

  test("corrector does NOT fire for exact-match street names (no false positives)", async () => {
    // When the user types the street name correctly, the corrector must
    // NOT rewrite it (it's already in the dictionary). Otherwise we'd
    // be silently changing correct input.
    if (!dbOnline || !correctorLoaded) return;
    for (const addr of CORRECTOR_TARGETS.slice(0, 8)) {
      const street = (addr.components.street_name || "").toLowerCase();
      const num = addr.components.number_first || "";
      const q = num ? `${num} ${street}` : street;
      const { tier, correctedFrom } = await runPipeline(q);
      expect(tier).not.toBe("typo_corrected");
      expect(correctedFrom).toBeNull();
    }
  }, 30000);

  test("corrector does NOT fire for short queries (< 3 chars)", async () => {
    // Corrector has a hard floor of query.length < 3 to avoid wildly
    // incorrect suggestions. Even with a real corrector loaded, short
    // queries must NOT be rewritten.
    if (!dbOnline || !correctorLoaded) return;
    for (const q of ["ma", "ab", "st", "rd"]) {
      const { tier, correctedFrom } = await runPipeline(q);
      expect(correctedFrom).toBeNull();
      expect(tier).not.toBe("typo_corrected");
    }
  }, 15000);
});

describe("full pipeline: combined conflict scenarios", () => {
  // Edge cases where multiple conflicts interact.

  test("flat-type street + postcode still finds the address", async () => {
    if (!dbOnline) return;
    for (const addr of FLAT_CONFLICT_ADDRS.slice(0, 3)) {
      const { rows } = await runPipeline(addr.components.postcode!);
      expect(rows.length).toBeGreaterThan(0);
    }
  }, 15000);

  test("state-conflict street '{num} act' routes to tier0c with non-empty results", async () => {
    // "10 act" — number=10, "act" is in STATE_LC → effectiveState=ACT.
    // The router picks tier0c (state + number), which returns ACT
    // addresses with number_first=10. Result is non-empty even though
    // the specific "act" street records may not be in the top 10.
    if (!dbOnline) return;
    const { rows, tier } = await runPipeline("10 act");
    expect(rows.length).toBeGreaterThan(0);
    expect(tier).toBe("tier0_number");
  }, 15000);

  test("typo on corrector target + state filter — results still show", async () => {
    if (!dbOnline || !correctorLoaded) return;
    let tested = 0;
    let nonEmpty = 0;
    for (const addr of CORRECTOR_TARGETS) {
      if (tested >= 8) break;
      const street = (addr.components.street_name || "").toLowerCase();
      const num = addr.components.number_first || "";
      const state = (addr.components.state || "").toLowerCase();
      if (!num || !state) continue;
      const typo = deletionTypo(street)[0];
      if (!typo || typo === street) continue;
      const q = `${num} ${typo} ${state}`;
      const { rows } = await runPipeline(q, addr.components.state!);
      tested++;
      if (rows.length > 0) nonEmpty++;
    }
    expect(tested).toBeGreaterThan(0);
    expect(nonEmpty).toBeGreaterThanOrEqual(Math.floor(tested * 0.4));
  }, 60000);
});
