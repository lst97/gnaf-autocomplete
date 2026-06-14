import { getCorrector } from "./corrector";

export interface TokenizedQuery {
  raw: string;
  normalized: string;
  tokens: string[];
  startsWithNumber: boolean;
  streetNumber: number | null;
  streetPrefix: string | null;
  isPurePrefix: boolean;
  localityPrefix: string | null;
  /** True when the query starts with a flat type code (unit/apt/flat).
   *  When true, following numbers are flat/unit numbers — skip the
   *  street-number boost in tier 1. */
  flatTypeAhead: boolean;
  /** The flat/unit number when flatTypeAhead is true, e.g. "2" from
   *  "unit 2, 14-26 audsley". Used for display-text boost in ranking. */
  flatNumber: number | null;
  /** If the in-memory street corrector rewrote the street prefix, this is
   *  the original (pre-correction) value. Lets the API surface
   *  "Did you mean GRESFORD?" hints when the user typed "gresfodr". */
  correctedFrom: string | null;
  /** If the locality corrector rewrote the locality prefix, this is the
   *  original (pre-correction) value. */
  localityCorrectedFrom: string | null;
  /** If the state corrector rewrote a state-code token, this is the
   *  original (pre-correction) value. */
  stateCorrectedFrom: string | null;
}

const VALID_STATES = new Set(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA", "OT"]);
const VALID_STATES_LC = new Set([...VALID_STATES].map((s) => s.toLowerCase()));

const STATE_LC = new Set([...VALID_STATES].map((s) => s.toLowerCase()));

// Common street type suffixes (abbreviated & full) — the last token should
// never be treated as a locality when it matches one of these.
export const STREET_TYPE_LC = new Set([
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

// G-NAF flat type codes — when the user types "unit" / "apt" / "flat" / "u",
// they're describing a flat type, not a street name.
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

// ──────────────────────────────────────────────────────────────────────────
//  Standard Levenshtein distance (two-row implementation)
// ──────────────────────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  let curr = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] as number) + 1, // insertion
        (prev[j] as number) + 1, // deletion
        (prev[j - 1] as number) + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] as number;
}

// ──────────────────────────────────────────────────────────────────────────
//  State corrector — closed-set Levenshtein-1 against the 9 AU state codes
// ──────────────────────────────────────────────────────────────────────────

/**
 * Correct a state-code typo.
 *
 * Only returns a correction when exactly one valid state has Levenshtein
 * distance 1 from the input token. Returns null for:
 *  - exact matches (no correction needed)
 *  - ambiguous candidates (e.g. "ns" → NSW, NT, or SA all at distance 1)
 *  - inputs with length <2 or >4 chars
 *  - inputs with no candidate within 1 edit
 */
export function correctStateToken(token: string): string | null {
  if (!token || token.length < 2 || token.length > 4) return null;
  const lc = token.toLowerCase();
  if (STATE_LC.has(lc)) return null;

  let best: string | null = null;
  let bestDist = Infinity;
  let ambiguous = false;

  for (const valid of VALID_STATES_LC) {
    const d = levenshtein(lc, valid);
    if (d === 0) return null; // exact match (shouldn't happen given check above, but safe)
    if (d < bestDist) {
      bestDist = d;
      best = valid;
      ambiguous = false;
    } else if (d === bestDist && d <= 1) {
      ambiguous = true;
    }
  }

  if (!best || bestDist > 1 || ambiguous) return null;
  return best.toUpperCase();
}

// ──────────────────────────────────────────────────────────────────────────
//  Tokenizer helpers
// ──────────────────────────────────────────────────────────────────────────

/** Detect tokens like "u2" (flat type U + number 2) or "unit5" (UNIT + 5). */
function isFlatTypePrefixed(t: string): boolean {
  const m = t.toLowerCase().match(/^([a-z]+)(\d+)$/);
  return m !== null && m[1] !== undefined && FLAT_TYPE_LC.has(m[1]);
}

function findPrefixToken(tokens: string[], startIdx: number): string | null {
  for (let i = startIdx; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    const lc = t.toLowerCase();
    if (
      !STATE_LC.has(lc) &&
      !FLAT_TYPE_LC.has(lc) &&
      !STREET_TYPE_LC.has(lc) &&
      /^[a-z]+$/.test(lc) &&
      t.length >= 1
    ) {
      return t;
    }
  }
  return null;
}

function extractLeadingParts(tokens: string[]): {
  streetNumber: number | null;
  streetPrefix: string | null;
} {
  if (tokens.length === 0) return { streetNumber: null, streetPrefix: null };

  let idx = 0;

  // Skip leading flat type codes
  while (idx < tokens.length) {
    const t = tokens[idx];
    if (t && (FLAT_TYPE_LC.has(t.toLowerCase()) || isFlatTypePrefixed(t))) {
      idx++;
      continue;
    }
    break;
  }

  let candidate = tokens[idx];
  if (!candidate) return { streetNumber: null, streetPrefix: null };

  // Strip leading/trailing commas
  candidate = candidate.replace(/^,|,$/g, "");

  // Handle number range "N-M"
  const rangeMatch = /^(\d+)-(\d+)$/.exec(candidate);
  if (rangeMatch?.[1]) {
    candidate = rangeMatch[1];
  }

  // Handle "X/Y" pattern
  if (candidate.includes("/")) {
    const parts = candidate.split("/");
    const last = parts[parts.length - 1];
    if (parts.length >= 2 && last && /^\d+$/.test(last)) {
      candidate = last;
    }
  }

  if (/^\d+$/.test(candidate)) {
    const nextStr = tokens[idx + 1];
    if (nextStr && (/^\d+$/.test(nextStr) || /^\d+-\d+$/.test(nextStr))) {
      const rangeM = nextStr.match(/^(\d+)-(\d+)$/);
      const streetNum = rangeM ? Number(rangeM[1]) : Number(nextStr);
      const prefix = findPrefixToken(tokens, idx + 2);
      return { streetNumber: streetNum, streetPrefix: prefix };
    }
    const prefix = findPrefixToken(tokens, idx + 1);
    return { streetNumber: Number(candidate), streetPrefix: prefix };
  }
  if (/^[a-z]+$/.test(candidate) && !STATE_LC.has(candidate) && candidate.length >= 1) {
    return { streetNumber: null, streetPrefix: candidate };
  }
  return { streetNumber: null, streetPrefix: null };
}

function extractFlatNumber(tokens: string[]): number | null {
  let idx = 0;
  while (idx < tokens.length) {
    const t = tokens[idx];
    if (t && (FLAT_TYPE_LC.has(t.toLowerCase()) || isFlatTypePrefixed(t))) {
      idx++;
      continue;
    }
    break;
  }
  const c = tokens[idx];
  if (!c) return null;
  const cleaned = c.replace(/^,|,$/g, "");
  if (/^\d+$/.test(cleaned)) {
    const nextStr = tokens[idx + 1];
    if (nextStr && (/^\d+$/.test(nextStr) || /^\d+-\d+$/.test(nextStr))) {
      return Number(cleaned);
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
//  Main entry point
// ──────────────────────────────────────────────────────────────────────────

export function tokenizeQuery(q: string): TokenizedQuery {
  const normalized = q.trim().toLowerCase();
  const tokens = normalized.split(/[\s/]+/).filter(Boolean);

  const startsWithNumber = tokens.length > 0 && tokens[0] ? /^\d+$/.test(tokens[0]) : false;
  const isPurePrefix = tokens.every((t) => t.length <= 4 || /^[a-z]+$/.test(t));
  const flatTypeAhead = tokens.length > 0 && tokens[0] ? FLAT_TYPE_LC.has(tokens[0]) : false;
  const flatNumber = extractFlatNumber(tokens);

  const { streetNumber, streetPrefix: rawPrefix } = extractLeadingParts(tokens);
  let streetPrefix = rawPrefix;
  let correctedFrom: string | null = null;

  // Apply street corrector (≥4 chars only)
  if (streetPrefix && streetPrefix.length >= 4) {
    const corrector = getCorrector();
    if (corrector) {
      const corrected = corrector.correctStreet(streetPrefix);
      if (corrected && corrected !== streetPrefix) {
        correctedFrom = streetPrefix;
        streetPrefix = corrected;
      }
    }
  }

  // Extract locality prefix (last token)
  const rawLast = tokens[tokens.length - 1];
  const lastToken = rawLast ? rawLast.replace(/^,+|,+$/g, "") : null;
  let localityPrefix: string | null =
    lastToken &&
    lastToken.length >= 2 &&
    !/^\d+$/.test(lastToken) &&
    !/^\d+-\d+$/.test(lastToken) &&
    !VALID_STATES.has(lastToken.toUpperCase()) &&
    !STREET_TYPE_LC.has(lastToken)
      ? lastToken
      : null;

  let localityCorrectedFrom: string | null = null;

  // Apply locality corrector (≥2 chars). The corrector only suggests
  // a correction when there's a unique Levenshtein match, so false positives
  // are rare even at this low threshold.
  if (localityPrefix && localityPrefix.length >= 2) {
    const corrector = getCorrector();
    if (corrector) {
      const corrected = corrector.correctLocality(localityPrefix);
      if (corrected && corrected !== localityPrefix) {
        localityCorrectedFrom = localityPrefix;
        localityPrefix = corrected;
      }
    }
  }

  // State correction: scan tokens; if a correction is found, record the
  // original token so `detectStateFilter` can return the corrected value.
  // Skip tokens that are known non-states (flat types, street types).
  let stateCorrectedFrom: string | null = null;
  for (const token of tokens) {
    const lc = token.toLowerCase();
    if (VALID_STATES.has(token.toUpperCase())) {
      break; // exact match exists — no correction needed
    }
    if (FLAT_TYPE_LC.has(lc) || STREET_TYPE_LC.has(lc)) continue;
    const corrected = correctStateToken(token);
    if (corrected) {
      stateCorrectedFrom = token;
      break;
    }
  }

  return {
    raw: q,
    normalized,
    tokens,
    startsWithNumber,
    streetNumber,
    streetPrefix,
    isPurePrefix,
    localityPrefix,
    flatTypeAhead,
    flatNumber,
    correctedFrom,
    localityCorrectedFrom,
    stateCorrectedFrom,
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  Exported filters (used by router and suggest API)
// ──────────────────────────────────────────────────────────────────────────

export function detectStateFilter(query: TokenizedQuery): string | null {
  for (const token of query.tokens) {
    if (VALID_STATES.has(token.toUpperCase())) {
      return token.toUpperCase();
    }
  }
  // If no exact match but the tokenizer found a correction candidate,
  // return the corrected state.
  if (query.stateCorrectedFrom) {
    const corrected = correctStateToken(query.stateCorrectedFrom);
    if (corrected) return corrected;
  }
  return null;
}

export function detectPostcodeFilter(query: TokenizedQuery): string | null {
  for (let i = query.tokens.length - 1; i >= 0; i--) {
    const token = query.tokens[i];
    if (token && /^\d{4}$/.test(token)) {
      if (
        query.streetNumber !== null &&
        String(query.streetNumber) === token &&
        query.streetPrefix &&
        query.streetPrefix.length >= 3
      ) {
        continue;
      }
      return token;
    }
  }
  return null;
}
