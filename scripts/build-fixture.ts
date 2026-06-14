#!/usr/bin/env bun
/**
 * G-NAF Fixture Generator — builds ~10K edge-case-rich address fixture.
 *
 * Reads raw G-NAF PSV files from GNAF_DATA_DIR, joins across
 * ADDRESS_DETAIL × STREET_LOCALITY × LOCALITY × STATE × ADDRESS_DEFAULT_GEOCODE,
 * and produces a JSON fixture with typo variants for testing.
 *
 * Usage:
 *   GNAF_DATA_DIR="/path/to/G-NAF MAY 2026/Standard" bun run scripts/build-fixture.ts
 *
 * Output: tests/fixtures/addresses.json (~3-5MB)
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = process.env.GNAF_DATA_DIR ?? "/Users/lst97/Downloads/g-naf_may26_allstates_gda2020_psv_1023/G-NAF/G-NAF MAY 2026/Standard";
const OUT_DIR = join(import.meta.dirname, "..", "tests", "fixtures");
const OUT_FILE = join(OUT_DIR, "addresses.json");

const STATES = ["ACT", "NSW", "NT", "OT", "QLD", "SA", "TAS", "VIC", "WA"] as const;

// ──────────────────────────────────────────────────────────────────────────
//  PSV parsing helpers
// ──────────────────────────────────────────────────────────────────────────

function parsePsvLine(line: string): string[] {
  return line.replace(/\r$/, "").split("|");
}

function readPsv(filename: string, cb: (row: string[], lineNum: number) => void) {
  const text = readFileSync(filename, "utf8");
  if (!text) return;
  let header = true;
  let lineNum = 0;
  for (const line of text.split("\n")) {
    if (header) { header = false; continue; }
    if (!line.trim()) continue;
    const row = parsePsvLine(line);
    if (row.length < 2) continue;
    lineNum++;
    cb(row, lineNum);
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Data loading — maps keyed by PID
// ──────────────────────────────────────────────────────────────────────────

interface StateRow {
  stateAbbreviation: string;
}
interface LocalityRow {
  localityName: string;
  statePid: string;
  postcode: string;
}
interface StreetRow {
  streetName: string;
  streetTypeCode: string;
  streetSuffixCode: string;
  localityPid: string;
}
interface GeocodeRow {
  longitude: string;
  latitude: string;
}

const stateByPid = new Map<string, StateRow>();
const localityByPid = new Map<string, LocalityRow>();
const streetByPid = new Map<string, StreetRow>();
const geocodeByAddrPid = new Map<string, GeocodeRow>();

function loadState(name: string) {
  const f = join(DATA_DIR, `${name}_STATE_psv.psv`);
  readPsv(f, (row) => {
    // 0:STATE_PID, 3:STATE_NAME, 4:STATE_ABBREVIATION
    stateByPid.set(row[0]!, { stateAbbreviation: row[4] ?? "" });
  });
}

function loadLocality(name: string) {
  const f = join(DATA_DIR, `${name}_LOCALITY_psv.psv`);
  readPsv(f, (row) => {
    // 0:LOCALITY_PID, 3:LOCALITY_NAME, 5:PRIMARY_POSTCODE, 6:STATE_PID
    if (row[2] && row[2] !== "") return; // date_retired !== null → skip
    localityByPid.set(row[0]!, {
      localityName: row[3] ?? "",
      statePid: row[6] ?? "",
      postcode: row[4] ?? "",
    });
  });
}

function loadStreet(name: string) {
  const f = join(DATA_DIR, `${name}_STREET_LOCALITY_psv.psv`);
  readPsv(f, (row) => {
    // 0:STREET_LOCALITY_PID, 2:DATE_RETIRED, 4:STREET_NAME, 5:STREET_TYPE_CODE, 6:STREET_SUFFIX_CODE, 7:LOCALITY_PID
    if (row[2] && row[2] !== "") return; // retired → skip
    streetByPid.set(row[0]!, {
      streetName: row[4] ?? "",
      streetTypeCode: row[5] ?? "",
      streetSuffixCode: row[6] ?? "",
      localityPid: row[7] ?? "",
    });
  });
}

function loadGeocode(name: string) {
  const f = join(DATA_DIR, `${name}_ADDRESS_DEFAULT_GEOCODE_psv.psv`);
  readPsv(f, (row) => {
    // 0:ADDRESS_DEFAULT_GEOCODE_PID, 3:ADDRESS_DETAIL_PID, 5:LONGITUDE, 6:LATITUDE
    const addrPid = row[3]!;
    // Skip if we already have one (pick first default geocode)
    if (geocodeByAddrPid.has(addrPid)) return;
    geocodeByAddrPid.set(addrPid, {
      longitude: row[5] ?? "",
      latitude: row[6] ?? "",
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────
//  Edge case classification
// ──────────────────────────────────────────────────────────────────────────

interface AddressRecord {
  pid: string;
  display: string;
  // Components for display generation
  buildingName: string;
  lotNumberPrefix: string;
  lotNumber: string;
  lotNumberSuffix: string;
  flatTypeCode: string;
  flatNumberPrefix: string;
  flatNumber: string;
  flatNumberSuffix: string;
  levelTypeCode: string;
  levelNumberPrefix: string;
  levelNumber: string;
  levelNumberSuffix: string;
  numberFirstPrefix: string;
  numberFirst: string;
  numberFirstSuffix: string;
  numberLastPrefix: string;
  numberLast: string;
  numberLastSuffix: string;
  streetName: string;
  streetType: string;
  streetSuffix: string;
  localityName: string;
  state: string;
  postcode: string;
  lat: number | null;
  lon: number | null;
  confidence: number | null;
  locationDescription: string;
  aliasPrincipal: string;
  privateStreet: string;
  categories: string[];
}

const STREET_TYPE_ABBREV: Record<string, string> = {
  "ROAD": "RD", "STREET": "ST", "COURT": "CT", "AVENUE": "AV",
  "LANE": "LN", "PLACE": "PL", "DRIVE": "DR", "CLOSE": "CL",
  "CRESCENT": "CR", "TERRACE": "TCE", "CIRCUIT": "CCT", "PARADE": "PDE",
  "GROVE": "GR", "WALK": "WK", "BOULEVARD": "BV", "TRAIL": "TRL",
  "HIGHWAY": "HWY", "TRACK": "TK", "ACCESS": "ACCS", "PARKWAY": "PKWY",
  "ESPLANADE": "ESP", "PROMENADE": "PROM", "SQUARE": "SQ", "RISE": "RISE",
  "ROW": "ROW", "WAY": "WAY", "CIRCLE": "CIR", "GLEN": "GLN",
  "LOOP": "LOOP",
};

function buildDisplay(rec: AddressRecord): string {
  const parts: string[] = [];

  // Building name
  if (rec.buildingName) parts.push(rec.buildingName + ",");

  // Lot number
  if (rec.lotNumber) {
    const lot = ["Lot", rec.lotNumberPrefix, rec.lotNumber, rec.lotNumberSuffix].filter(Boolean).join("");
    parts.push(lot + ",");
  }

  // Flat type + number
  if (rec.flatTypeCode || rec.flatNumber) {
    const flat = [rec.flatTypeCode, rec.flatNumberPrefix, rec.flatNumber, rec.flatNumberSuffix].filter(Boolean).join(" ");
    if (flat) parts.push(flat + ",");
  }

  // Level type + number
  if (rec.levelTypeCode || rec.levelNumber) {
    const level = [rec.levelTypeCode, rec.levelNumberPrefix, rec.levelNumber, rec.levelNumberSuffix].filter(Boolean).join(" ");
    if (level) parts.push(level + ",");
  }

  // Street number
  const streetNum = [
    rec.numberFirstPrefix,
    rec.numberFirst,
    rec.numberFirstSuffix,
    rec.numberLast ? "-" + [rec.numberLastPrefix, rec.numberLast, rec.numberLastSuffix].filter(Boolean).join("") : "",
  ].filter(Boolean).join("");
  if (streetNum) parts.push(streetNum);

  // Street name + type + suffix
  const street = [rec.streetName, rec.streetType ? (STREET_TYPE_ABBREV[rec.streetType] ?? rec.streetType) : ""].filter(Boolean).join(" ");
  if (street) parts.push(street);

  // Locality, State, Postcode
  parts.push(rec.localityName + " " + rec.state + " " + rec.postcode);

  return parts.join(", ");
}

function classifyAddress(rec: AddressRecord): string[] {
  const cats: string[] = [];

  if (rec.flatTypeCode) {
    cats.push("flat_" + rec.flatTypeCode);
    if (rec.flatNumber) cats.push("flat_with_number");
  }
  if (rec.levelTypeCode) {
    cats.push("level_" + rec.levelTypeCode);
    if (rec.levelNumber) cats.push("level_with_number");
  }
  if (rec.numberLast) cats.push("number_range");
  if (rec.numberFirstPrefix || rec.numberFirstSuffix) cats.push("number_suffix");
  if (rec.buildingName) cats.push("building_name");
  if (rec.lotNumber) cats.push("lot_number");
  if (rec.locationDescription) cats.push("location_description");
  if (rec.streetSuffix) cats.push("street_suffix_" + rec.streetSuffix);
  if (rec.aliasPrincipal === "A") cats.push("alias");
  if (rec.privateStreet === "Y") cats.push("private_street");
  if (rec.confidence === -1) cats.push("confidence_unverified");
  if (rec.confidence === null) cats.push("confidence_null");
  if (rec.lat === null || rec.lon === null) cats.push("no_geocode");
  if (!rec.streetName) cats.push("no_street");

  // Street type categories
  if (rec.streetType) cats.push("street_type_" + rec.streetType.toLowerCase());

  // Number categories
  if (rec.numberFirst) {
    const n = parseInt(rec.numberFirst, 10);
    if (n > 1000) cats.push("high_number");
    if (n === 1) cats.push("number_one");
  }

  cats.push("state_" + rec.state.toLowerCase());
  cats.push("confidence_" + (rec.confidence != null ? rec.confidence : "null"));

  if (cats.length === 0) cats.push("standard");
  return cats;
}

// ──────────────────────────────────────────────────────────────────────────
//  Typo variant generation
// ──────────────────────────────────────────────────────────────────────────

function streetNumberVariants(streetNum: string, numberFirst: string): string[] {
  const out: string[] = [];
  if (!streetNum) return [""];
  const q = streetNum.toLowerCase();
  // Just the number
  if (numberFirst) {
    const n = parseInt(numberFirst, 10);
    // Off-by-one typos
    if (n > 1) out.push(String(n - 1) + " "); // e.g., 1 instead of 2
    if (n < 99999) out.push(String(n + 1) + " "); // e.g., 3 instead of 2
    // Drop the number entirely
    out.push("");
  }
  return out;
}

function streetNameTypos(name: string): string[] {
  if (!name || name.length < 4) return [name];
  const lc = name.toLowerCase();
  const out: string[] = [lc];
  
  // 1-char deletion
  if (lc.length >= 4) {
    for (let i = 1; i < lc.length - 1; i++) {
      out.push(lc.slice(0, i) + lc.slice(i + 1));
      if (out.length >= 3) break;
    }
  }
  
  // 1-char substitution (skip for short names)
  if (lc.length >= 4) {
    const vowels = "aeiou";
    for (let i = 1; i < lc.length - 1; i++) {
      if (vowels.includes(lc[i]!)) {
        const sub = vowels[(vowels.indexOf(lc[i]!) + 1) % 5]!;
        out.push(lc.slice(0, i) + sub + lc.slice(i + 1));
        break;
      }
    }
  }
  
  return [...new Set(out)];
}

const STREET_TYPE_PAIRS: [string, string][] = [
  ["ST", "RD"], ["RD", "ST"], ["DR", "RD"], ["LN", "ST"],
  ["CL", "CT"], ["CT", "CL"], ["PL", "LN"], ["CR", "ST"],
  ["AV", "ST"], ["PDE", "RD"], ["TCE", "ST"],
];

function streetTypeTypos(type: string): string[] {
  const abbrev = STREET_TYPE_ABBREV[type] ?? type;
  if (!abbrev) return [""];
  const out: string[] = [""];
  for (const [from, to] of STREET_TYPE_PAIRS) {
    if (abbrev === from) {
      out.push(" " + to.toLowerCase());
      break;
    }
  }
  return [...new Set(out)];
}

function localityNameVariants(name: string): string[] {
  if (!name || name.length < 4) return [name.toLowerCase()];
  const lc = name.toLowerCase();
  const out: string[] = [lc];
  // 1-char deletion
  for (let i = 1; i < lc.length - 1; i++) {
    out.push(lc.slice(0, i) + lc.slice(i + 1));
    if (out.length >= 2) break;
  }
  return [...new Set(out)];
}

function stateTypos(state: string): string[] {
  const out: string[] = [state.toLowerCase()];
  // Common typos
  const typos: Record<string, string[]> = {
    "NSW": ["nswq", "nzw", "nsw"],
    "VIC": ["vicc", "vic", "vvic"],
    "QLD": ["qldq", "qld", "quld"],
    "WA": ["wa", "wqa", "waa"],
    "SA": ["sa", "sqa", "saa"],
    "TAS": ["taz", "tas", "tazz"],
    "ACT": ["actt", "act", "acct"],
    "NT": ["nt", "ntt", "nnt"],
    "OT": ["ot", "ott", "oht"],
  };
  const t = typos[state];
  if (t) out.push(t[0]!);
  return [...new Set(out)];
}

function generateTypoVariants(rec: AddressRecord): Array<{ query: string; description: string }> {
  const variants: Array<{ query: string; description: string }> = [];
  const sn = rec.streetName?.toLowerCase() ?? "";
  const st = rec.streetType ?? "";
  const stAbbrev = STREET_TYPE_ABBREV[st] ?? "";
  const num = rec.numberFirst ?? "";
  const loc = rec.localityName?.toLowerCase() ?? "";
  const state = rec.state ?? "";
  const postcode = rec.postcode ?? "";

  // 1. Exact correct query
  const exactQuery = [num, sn, stAbbrev.toLowerCase(), loc, state.toLowerCase(), postcode].filter(Boolean).join(" ");
  variants.push({ query: exactQuery, description: "exact" });

  // 2. Just street name + type + suburb
  const shortQuery = [sn, stAbbrev.toLowerCase(), loc].filter(Boolean).join(" ");
  if (shortQuery !== exactQuery) variants.push({ query: shortQuery, description: "short (no number/no state/no postcode)" });

  // 3. Typo in street name
  for (const typo of streetNameTypos(sn)) {
    if (typo === sn) continue;
    const q = [num, typo, stAbbrev.toLowerCase(), loc, state.toLowerCase()].filter(Boolean).join(" ");
    if (q !== exactQuery) variants.push({ query: q, description: `street typo: "${sn}" → "${typo}"` });
    break; // just one street typo per record
  }

  // 4. Typo in street type
  for (const stTypo of streetTypeTypos(st)) {
    if (!stTypo) continue;
    const q = [num, sn, stTypo.trim(), loc].filter(Boolean).join(" ");
    if (q !== exactQuery) variants.push({ query: q, description: `street type typo: "${stAbbrev}" → "${stTypo.trim()}"` });
    break;
  }

  // 5. Typo in locality/suburb
  for (const locTypo of localityNameVariants(loc)) {
    if (locTypo === loc) continue;
    const q = [num, sn, stAbbrev.toLowerCase(), locTypo, state.toLowerCase()].filter(Boolean).join(" ");
    if (q !== exactQuery) variants.push({ query: q, description: `locality typo: "${loc}" → "${locTypo}"` });
    break;
  }

  // 6. Typo in state
  for (const stateTypo of stateTypos(state)) {
    if (stateTypo === state.toLowerCase()) continue;
    const q = [num, sn, stAbbrev.toLowerCase(), loc, stateTypo].filter(Boolean).join(" ");
    if (q !== exactQuery) variants.push({ query: q, description: `state typo: "${state}" → "${stateTypo}"` });
    break;
  }

  // 7. Just postcode (no street)
  if (postcode) {
    variants.push({ query: postcode, description: "postcode only" });
  }

  // 8. State + postcode
  if (state && postcode) {
    const q = [loc, state.toLowerCase(), postcode].filter(Boolean).join(" ");
    variants.push({ query: q, description: "locality + state + postcode" });
  }

  // 9. Flat/level prefix if applicable
  if (rec.flatTypeCode && rec.flatNumber) {
    const q = [rec.flatTypeCode.toLowerCase(), rec.flatNumber, num, sn, stAbbrev.toLowerCase(), loc].filter(Boolean).join(" ");
    variants.push({ query: q, description: "flat type prefix" });
  }
  if (rec.levelTypeCode && rec.levelNumber) {
    const q = [rec.levelTypeCode.toLowerCase(), rec.levelNumber, num, sn, stAbbrev.toLowerCase(), loc].filter(Boolean).join(" ");
    variants.push({ query: q, description: "level type prefix" });
  }

  // 10. Typo in flat number (off by one)
  if (rec.flatTypeCode && rec.flatNumber) {
    const fn = parseInt(rec.flatNumber, 10);
    if (!isNaN(fn)) {
      const typoFn = fn + 1;
      const q = [rec.flatTypeCode.toLowerCase(), typoFn, num, sn, stAbbrev.toLowerCase(), loc].filter(Boolean).join(" ");
      if (q !== exactQuery) variants.push({ query: q, description: "flat number +1 typo" });
    }
  }

  return variants;
}

// ──────────────────────────────────────────────────────────────────────────
//  Main — collect addresses
// ──────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Loading STATE data...");
  for (const s of STATES) loadState(s);

  console.log("Loading LOCALITY data...");
  for (const s of STATES) loadLocality(s);

  console.log("Loading STREET_LOCALITY data...");
  for (const s of STATES) loadStreet(s);

  console.log("Loading ADDRESS_DEFAULT_GEOCODE data...");
  for (const s of STATES) loadGeocode(s);

  console.log(`  stateByPid: ${stateByPid.size}`);
  console.log(`  localityByPid: ${localityByPid.size}`);
  console.log(`  streetByPid: ${streetByPid.size}`);
  console.log(`  geocodeByAddrPid: ${geocodeByAddrPid.size}`);

  // ── Edge case collection ──

  const collected: AddressRecord[] = [];
  const PIDS_SEEN = new Set<string>();
  const collectedByState: Record<string, number> = {};
  for (const s of STATES) collectedByState[s] = 0;

  // Per-state cap: 1112 gives ~10K across 9 states with minimal trimming.
  const MAX_PER_STATE = 1112;
  const TARGETS: Array<{ cat: string; max: number; desc: string }> = [
    { cat: "level", max: 500, desc: "Level/floor addresses (L1, L2, LB, LG)" },
    { cat: "flat", max: 500, desc: "Flat/unit addresses" },
    { cat: "number_range", max: 300, desc: "Number ranges (6-14)" },
    { cat: "number_suffix", max: 200, desc: "Number prefixes/suffixes (1A, 2B)" },
    { cat: "building_name", max: 400, desc: "Building names" },
    { cat: "lot_number", max: 300, desc: "Lot numbers" },
    { cat: "location_description", max: 100, desc: "Location descriptions (rural)" },
    { cat: "street_suffix", max: 300, desc: "Street suffixes (N, S, E, W)" },
    { cat: "private_street", max: 100, desc: "Private streets" },
    { cat: "no_geocode", max: 100, desc: "Missing geocode" },
    { cat: "confidence_unverified", max: 200, desc: "Confidence -1 (unverified)" },
    { cat: "confidence_null", max: 100, desc: "Confidence NULL" },
    { cat: "high_number", max: 200, desc: "High street numbers (>1000)" },
    { cat: "alias", max: 100, desc: "Alias addresses" },
  ];

  function needsMore(rec: AddressRecord, cats: string[]): boolean {
    if (PIDS_SEEN.has(rec.pid)) return false;

    // Per-state cap — keeps distribution even
    const perState = collectedByState[rec.state] ?? 0;
    if (perState >= MAX_PER_STATE) return false;

    // Edge case targets
    for (const t of TARGETS) {
      if (cats.some(c => c.startsWith(t.cat))) {
        const current = collected.filter(r => r.categories.some(c => c.startsWith(t.cat))).length;
        if (current < t.max) return true;
      }
    }

    // Fallback: accept if we still have room in this state
    return true;
  }

  // Scan each state's ADDRESS_DETAIL
  for (const stateCode of STATES) {
    const fd = join(DATA_DIR, `${stateCode}_ADDRESS_DETAIL_psv.psv`);
    console.log(`\nScanning ${stateCode}...`);

    let scanned = 0;
    readPsv(fd, (row) => {
      scanned++;

      // Quick skip if this state's cap is reached (avoids parsing millions of rows)
      const stateCap = collectedByState[stateCode] ?? 0;
      if (stateCap >= MAX_PER_STATE) return;

      // Skip retired addresses
      if (row[3] && row[3] !== "") return;

      // Parse address detail columns (0-indexed)
      const pid = row[0]!;
      if (PIDS_SEEN.has(pid)) return;

      const buildingName = row[4] ?? "";
      const lotNumberPrefix = row[5] ?? "";
      const lotNumber = row[6] ?? "";
      const lotNumberSuffix = row[7] ?? "";
      const flatTypeCode = row[8] ?? "";
      const flatNumberPrefix = row[9] ?? "";
      const flatNumber = row[10] ?? "";
      const flatNumberSuffix = row[11] ?? "";
      const levelTypeCode = row[12] ?? "";
      const levelNumberPrefix = row[13] ?? "";
      const levelNumber = row[14] ?? "";
      const levelNumberSuffix = row[15] ?? "";
      const numberFirstPrefix = row[16] ?? "";
      const numberFirst = row[17] ?? "";
      const numberFirstSuffix = row[18] ?? "";
      const numberLastPrefix = row[19] ?? "";
      const numberLast = row[20] ?? "";
      const numberLastSuffix = row[21] ?? "";
      const streetLocalityPid = row[22] ?? "";
      const locationDescription = row[23] ?? "";
      const localityPid = row[24] ?? "";
      const aliasPrincipal = row[25] ?? "";
      const postcode = row[26] ?? "";
      const privateStreet = row[27] ?? "";
      const confidenceStr = row[29] ?? "";

      // Look up street
      const street = streetByPid.get(streetLocalityPid);
      if (!street) return;
      const streetName = street.streetName;
      const streetType = street.streetTypeCode;
      const streetSuffix = street.streetSuffixCode;
      const slLocalityPid = street.localityPid;

      // Look up locality
      const locPid = localityPid || slLocalityPid;
      const locality = localityByPid.get(locPid);
      if (!locality) return;
      const localityName = locality.localityName;

      // Look up state
      const stateRow = stateByPid.get(locality.statePid);
      if (!stateRow) return;
      const state = stateRow.stateAbbreviation;

      // Look up geocode
      const geo = geocodeByAddrPid.get(pid);
      const lat = geo ? parseFloat(geo.latitude) : null;
      const lon = geo ? parseFloat(geo.longitude) : null;
      const finalLat = (lat != null && !isNaN(lat)) ? lat : null;
      const finalLon = (lon != null && !isNaN(lon)) ? lon : null;

      const confidence = confidenceStr ? parseInt(confidenceStr, 10) : null;

      const rec: AddressRecord = {
        pid, display: "", // filled below
        buildingName, lotNumberPrefix, lotNumber, lotNumberSuffix,
        flatTypeCode, flatNumberPrefix, flatNumber, flatNumberSuffix,
        levelTypeCode, levelNumberPrefix, levelNumber, levelNumberSuffix,
        numberFirstPrefix, numberFirst, numberFirstSuffix,
        numberLastPrefix, numberLast, numberLastSuffix,
        streetName, streetType, streetSuffix,
        localityName, state, postcode,
        lat: finalLat, lon: finalLon,
        confidence,
        locationDescription, aliasPrincipal, privateStreet,
        categories: [],
      };

      rec.display = buildDisplay(rec);
      rec.categories = classifyAddress(rec);

      if (needsMore(rec, rec.categories)) {
        PIDS_SEEN.add(pid);
        collected.push(rec);
        collectedByState[rec.state] = (collectedByState[rec.state] ?? 0) + 1;
      }

      // Progress every 100K rows
      if (scanned % 100000 === 0) {
        process.stdout.write(`\r  scanned ${scanned.toLocaleString()} rows, collected ${collected.length}`);
      }
    });
    console.log(`\r  scanned ${scanned.toLocaleString()} rows → collected ${collected.length} total`);
  }

  // Trim to exactly 10K while maintaining state balance
  const finalAddresses = collected.slice(0, 10000);

  // Build output with typo variants
  console.log(`\nGenerating typo variants for ${finalAddresses.length} addresses...`);
  const fixture = {
    metadata: {
      description: "G-NAF address fixture for autocomplete testing — edge-case-rich subset",
      source: "G-NAF MAY 2026",
      totalAddresses: finalAddresses.length,
      categories: [...new Set(finalAddresses.flatMap(a => a.categories))].sort(),
      generatedAt: new Date().toISOString(),
    },
    addresses: finalAddresses.map(rec => ({
      id: rec.pid,
      display: rec.display,
      components: {
        building_name: rec.buildingName || null,
        lot_number: rec.lotNumber || null,
        flat_type: rec.flatTypeCode || null,
        flat_number: rec.flatNumber || null,
        level_type: rec.levelTypeCode || null,
        level_number: rec.levelNumber || null,
        number_first: rec.numberFirst || null,
        number_first_suffix: rec.numberFirstSuffix || null,
        number_last: rec.numberLast || null,
        street_name: rec.streetName || null,
        street_type: rec.streetType || null,
        street_suffix: rec.streetSuffix || null,
        locality: rec.localityName || null,
        state: rec.state || null,
        postcode: rec.postcode || null,
      },
      lat: rec.lat,
      lon: rec.lon,
      confidence: rec.confidence,
      categories: rec.categories,
      typo_variants: generateTypoVariants(rec),
    })),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(fixture, null, 2));
  const size = statSync(OUT_FILE).size;
  console.log(`\nWritten to ${OUT_FILE} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Addresses: ${fixture.addresses.length}`);
  console.log(`Categories: ${fixture.metadata.categories.length}`);
}

main().catch(console.error);
