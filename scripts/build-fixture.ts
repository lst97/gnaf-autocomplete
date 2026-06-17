#!/usr/bin/env bun
/**
 * G-NAF Fixture Generator — builds ~1K edge-case-rich address fixture.
 *
 * Reads from the live address_search_mv (PostgreSQL) instead of raw PSV
 * files — the MV is indexed and instant.
 * Prioritises edge cases: 1-char streets, tokenizer-conflicting names,
 * flat/unit addresses, typo-prone names, all 9 AU states.
 *
 * Usage:
 *   bun run scripts/build-fixture.ts
 *
 * Output: tests/fixtures/addresses.json (~300-500KB)
 */

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeDb, getSql } from "../src/db/client";

const OUT_DIR = join(import.meta.dirname, "..", "tests", "fixtures");
const OUT_FILE = join(OUT_DIR, "addresses.json");

const STREET_TYPE_LC = new Set([
  "st",
  "street",
  "rd",
  "road",
  "dr",
  "drive",
  "av",
  "ave",
  "avenue",
  "ct",
  "court",
  "crt",
  "pl",
  "place",
  "ln",
  "lane",
  "cl",
  "close",
  "cr",
  "cres",
  "crescent",
  "tce",
  "terrace",
  "cct",
  "circuit",
  "pde",
  "parade",
  "gr",
  "grove",
  "bvd",
  "blvd",
  "boulevard",
  "hwy",
  "highway",
  "pkwy",
  "parkway",
  "esp",
  "esplanade",
  "tr",
  "trl",
  "trail",
  "tk",
  "track",
  "way",
  "rise",
  "row",
  "cir",
  "circle",
  "loop",
  "walk",
]);
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
const VALID_STATES = new Set(["act", "nsw", "nt", "qld", "sa", "tas", "vic", "wa", "ot"]);
const CORRECTOR_TARGETS = new Set([
  "gresford",
  "sydney",
  "wantirna",
  "yarralumla",
  "yarragon",
  "strathmore",
  "brighton",
  "camberwell",
  "toorak",
  "malvern",
]);

async function main() {
  const sql = getSql();

  const shortStreets: string[] = [];
  const conflictStreets: string[] = [];
  const correctorStreets: string[] = [];

  const rows = (await sql`SELECT DISTINCT street_lc FROM address_search_mv`) as Array<{
    street_lc: string;
  }>;
  for (const { street_lc } of rows) {
    const sn = (street_lc || "").toLowerCase();
    if (sn.length <= 2) shortStreets.push(sn);
    if (STREET_TYPE_LC.has(sn) || FLAT_TYPE_LC.has(sn) || VALID_STATES.has(sn))
      conflictStreets.push(sn);
    if (CORRECTOR_TARGETS.has(sn)) correctorStreets.push(sn);
  }
  console.log(`Distinct streets: ${rows.length}`);
  console.log(`  short (1-2 char): ${shortStreets.length}`);
  console.log(`  conflict names:   ${conflictStreets.length}`);
  console.log(`  corrector targets: ${correctorStreets.length}`);

  const collected: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  async function take(prefix: string, limit: number) {
    let count = 0;
    const r = await sql`
      SELECT address_detail_pid, display, street_lc, locality_lc,
             locality, number_first, state, postcode, confidence, lat, lon
      FROM address_search_mv
      WHERE street_lc LIKE ${`${prefix}%`}
      LIMIT ${limit * 3}
    `;
    for (const row of r) {
      if (count >= limit) break;
      if (seen.has(row.address_detail_pid)) continue;
      seen.add(row.address_detail_pid);
      collected.push(row);
      count++;
    }
    return count;
  }

  console.log("\nCollecting edge cases...");

  // Phase 1: short streets (highest priority)
  const shortTops = [...new Set(shortStreets)].sort();
  for (const s of shortTops.slice(0, 15)) {
    const n = await take(s, 4);
    if (n > 0) console.log(`  short street "${s}": ${n}`);
  }

  // Phase 2: conflict names
  const conflictTops = [...new Set(conflictStreets)].sort();
  for (const s of conflictTops.slice(0, 25)) {
    const n = await take(s, 5);
    if (n > 0) console.log(`  conflict "${s}": ${n}`);
  }

  // Phase 3: corrector targets
  for (const s of correctorStreets) {
    const n = await take(s, 8);
    if (n > 0) console.log(`  corrector "${s}": ${n}`);
  }

  // Phase 4: flat/unit/level addresses
  const flatRows = await sql`
    SELECT address_detail_pid, display, street_lc, locality_lc,
           locality, number_first, state, postcode, confidence, lat, lon
    FROM address_search_mv
    WHERE display LIKE 'UNIT %' OR display LIKE 'APT %'
       OR display LIKE 'FLAT %' OR display LIKE 'LEVEL %'
    LIMIT 100
  `;
  let flatCount = 0;
  for (const row of flatRows) {
    if (flatCount >= 80) break;
    if (!seen.has(row.address_detail_pid)) {
      seen.add(row.address_detail_pid);
      collected.push(row);
      flatCount++;
    }
  }
  console.log(`  flat addresses: ${flatCount}`);

  // Phase 5: state spread
  for (const state of ["ACT", "NSW", "NT", "OT", "QLD", "SA", "TAS", "VIC", "WA"]) {
    const sRows = await sql`
      SELECT address_detail_pid, display, street_lc, locality_lc,
             locality, number_first, state, postcode, confidence, lat, lon
      FROM address_search_mv
      WHERE state = ${state}
      LIMIT 50
    `;
    let sc = 0;
    for (const row of sRows) {
      if (sc >= 3) break;
      if (!seen.has(row.address_detail_pid)) {
        seen.add(row.address_detail_pid);
        collected.push(row);
        sc++;
      }
    }
  }

  // Phase 6: fill to 1000
  const needed = 1000 - collected.length;
  if (needed > 0) {
    const fillRows = await sql`
      SELECT address_detail_pid, display, street_lc, locality_lc,
             locality, number_first, state, postcode, confidence, lat, lon
      FROM address_search_mv
      LIMIT ${needed * 3}
    `;
    let fc = 0;
    for (const row of fillRows) {
      if (fc >= needed) break;
      if (!seen.has(row.address_detail_pid)) {
        seen.add(row.address_detail_pid);
        collected.push(row);
        fc++;
      }
    }
    console.log(`  general fill: ${fc}`);
  }

  const finalAddr = collected.slice(0, 1000);
  console.log(`\nTotal: ${finalAddr.length}`);

  const fixture = {
    metadata: {
      description: "G-NAF address fixture for autocomplete testing -- 1K edge-case-rich subset",
      source: "G-NAF MAY 2026 (via address_search_mv)",
      totalAddresses: finalAddr.length,
      generatedAt: new Date().toISOString(),
    },
    addresses: finalAddr.map((r) => ({
      id: r.address_detail_pid,
      display: r.display,
      components: {
        building_name: null,
        lot_number: null,
        flat_type: null,
        flat_number: null,
        level_type: null,
        level_number: null,
        number_first: r.number_first || null,
        number_first_suffix: null,
        number_last: null,
        street_name: r.street_lc || null,
        street_type: null,
        street_suffix: null,
        locality: r.locality || null,
        state: r.state || null,
        postcode: r.postcode || null,
      },
      lat: r.lat ? parseFloat(String(r.lat)) : null,
      lon: r.lon ? parseFloat(String(r.lon)) : null,
      confidence: r.confidence ? parseInt(String(r.confidence), 10) : null,
      categories: [],
    })),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(fixture, null, 2));
  const size = statSync(OUT_FILE).size;
  console.log(`Written to ${OUT_FILE} (${(size / 1024).toFixed(0)} KB)`);
  console.log(`Addresses: ${fixture.addresses.length}`);

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
