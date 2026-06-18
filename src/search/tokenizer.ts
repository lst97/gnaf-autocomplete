import {
  FLAT_TYPE_LC,
  ORDINAL_SUFFIX_LC,
  STREET_TYPE_ABBREV,
  STREET_TYPE_LC,
  VALID_STATES,
  VALID_STATES_LC,
} from "../lib/constants";
import { getCorrector } from "./corrector";

export interface TokenizedQuery {
  raw: string;
  normalized: string;
  tokens: string[];
  startsWithNumber: boolean;
  streetNumber: number | null;
  streetPrefix: string | null;
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
  /** Letter suffix from an alphanumeric street number, e.g. "a" from "6a".
   *  Null for pure-numeric street numbers. Used by tier1 to boost exact
   *  display-text matches like "6A ALBERT AV" over just "6 ALBERT AV". */
  numberSuffix: string | null;
  /** Street-type abbreviation (e.g. "ST,") if any token is a recognised
   *  street type. Comma-suffixed for direct use in tier1's `LIKE` boost. */
  streetTypeAbbrev: string | null;
}

export function extractStreetTypeAbbrev(tokens: readonly string[]): string | null {
  for (const t of tokens) {
    const lc = t.replace(/^,+|,+$/g, "").toLowerCase();
    const abbrev = STREET_TYPE_ABBREV[lc];
    if (abbrev) return `${abbrev},`;
  }
  return null;
}

// Combine a single-word locality with a non-street-type alphabetic token
// preceding it, e.g. "glen huntly" → "glen huntly". Covers multi-word AU
// suburbs ("mount waverley", "kings langley") that the tokenizer would
// otherwise split incorrectly.
export function combineMultiWordLocality(
  locality: string | null,
  tokens: readonly string[],
): string | null {
  if (!locality || tokens.length < 2) return locality;
  const penultimate = tokens[tokens.length - 2];
  if (penultimate && /^[a-z]{2,}$/.test(penultimate) && !STREET_TYPE_LC.has(penultimate)) {
    return `${penultimate} ${locality}`;
  }
  return locality;
}

// True for tokens like "12abc" — digit-leading mixed alphanumerics with ≥2
// trailing letters. G-NAF street numbers carry at most 1 trailing letter
// ("12", "12A"); anything with 2+ trailing letters is junk and would force
// the router into tier2/tier4 trigram fallback (which scans 16M rows and
// can take 15+ seconds). True for known street-type abbreviations like "st"
// or "rd" so they remain valid as a single-token input (e.g. "21st" matches
// street type "st" with prefix digits that were dropped from STREET_TYPE_LC).
export function isAlphanumericJunkToken(token: string): boolean {
  const match = /^\d+([a-z]{2,})$/i.exec(token);
  if (!match?.[1]) return false;
  const trailingLetters = match[1].toLowerCase();
  // Allow street-type abbreviations ("st", "rd") and ordinal suffixes
  // ("nd" for 2nd, "th" for 4th). Everything else is junk.
  return !STREET_TYPE_LC.has(trailingLetters) && !ORDINAL_SUFFIX_LC.has(trailingLetters);
}

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
const MIN_STATE_CODE_LEN = 2;
const MAX_STATE_CODE_LEN = 4;

export function correctStateToken(token: string): string | null {
  if (!token || token.length < MIN_STATE_CODE_LEN || token.length > MAX_STATE_CODE_LEN) return null;
  const lc = token.toLowerCase();
  if (VALID_STATES_LC.has(lc)) return null;

  let best: string | null = null;
  let bestDist = Infinity;
  let ambiguous = false;

  for (const valid of VALID_STATES_LC) {
    const d = levenshtein(lc, valid);
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

// Hot-path regexes hoisted to module scope.
const FLAT_PREFIX_RE = /^([a-z]+)(\d+)$/;
const COMMA_STRIP_RE = /^,|,$/g;
const RANGE_RE = /^(\d+)-(\d+)$/;
const ALPHA_NUM_SUFFIX_RE = /^(\d+)[a-z]$/;
const PURE_DIGIT_RE = /^\d+$/;
const ALPHA_START_RE = /^[a-z]/;
const ALPHA_SUFFIX_RE = /^\d+([a-z])$/;
const STATE_CODE_THREE_PLUS = 3;

/** Detect tokens like "u2" (flat type U + number 2) or "unit5" (UNIT + 5). */
function isFlatTypePrefixed(t: string): boolean {
  const m = t.toLowerCase().match(FLAT_PREFIX_RE);
  return m !== null && m[1] !== undefined && FLAT_TYPE_LC.has(m[1]);
}

/** Skip flat-type prefix tokens and return the index of the first non-flat-type token. */
function skipFlatTypePrefix(tokens: string[]): number {
  let idx = 0;
  while (idx < tokens.length) {
    const t = tokens[idx];
    if (t && (FLAT_TYPE_LC.has(t.toLowerCase()) || isFlatTypePrefixed(t))) {
      idx++;
      continue;
    }
    break;
  }
  return idx;
}

/** Normalise a candidate token by stripping commas, ranges, and slash patterns.
 *  Returns the cleaned value and a kind hint for the caller. */
interface ParsedCandidate {
  kind: "number" | "alpha" | "alphanum" | null;
  value: string;
}
function parseCandidate(raw: string): ParsedCandidate {
  let value = raw.replace(COMMA_STRIP_RE, "");
  // Extract the leading number from a range "12-56"
  const rangeMatch = value.match(RANGE_RE);
  if (rangeMatch?.[1]) value = rangeMatch[1];
  // Extract the last numeric part from slash patterns "1/6"
  if (value.includes("/")) {
    const parts = value.split("/");
    const last = parts[parts.length - 1];
    if (parts.length >= 2 && last && PURE_DIGIT_RE.test(last)) value = last;
  }
  if (PURE_DIGIT_RE.test(value)) return { kind: "number", value };
  if (ALPHA_NUM_SUFFIX_RE.test(value)) {
    // Single letter suffix — e.g., "12a" → street number 12 with suffix "a"
    const numericPart = value.replace(/[a-z]$/, "");
    return { kind: "alphanum", value: numericPart };
  }
  // Ordinal or street-type prefixed token like "2nd", "4th", "21st".
  // These are street names (e.g. "2nd avenue"), not street numbers.
  // Treat them as alphabetic street prefixes so they route to tier1.
  const suffixMatch = /^\d+([a-z]{2,})$/i.exec(value);
  if (suffixMatch?.[1]) {
    const trailing = suffixMatch[1].toLowerCase();
    if (STREET_TYPE_LC.has(trailing) || ORDINAL_SUFFIX_LC.has(trailing)) {
      return { kind: "alpha", value };
    }
  }
  if (ALPHA_START_RE.test(value)) return { kind: "alpha", value };
  return { kind: null, value };
}

function findPrefixToken(tokens: string[], startIdx: number): string | null {
  for (let i = startIdx; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    const lc = t.toLowerCase();
    // Also accept ordinal/street-type prefixed tokens like "2nd", "4th", "21st"
    // as street prefixes (they're street names, not street numbers).
    const suffixMatch = /^\d+([a-z]{2,})$/i.exec(t);
    const isOrdinalPrefix =
      suffixMatch?.[1] &&
      (STREET_TYPE_LC.has(suffixMatch[1].toLowerCase()) ||
        ORDINAL_SUFFIX_LC.has(suffixMatch[1].toLowerCase()));
    if (
      !VALID_STATES_LC.has(lc) &&
      !FLAT_TYPE_LC.has(lc) &&
      (ALPHA_START_RE.test(lc) || isOrdinalPrefix) &&
      t.length >= 1 &&
      // Reject state-correction tokens ("nzw" → NSW) as street prefixes.
      // Only for ≥3 chars; 2-char tokens are too ambiguous.
      // Skip STREET_TYPE_LC tokens ("way" → WA is a false positive).
      (t.length < STATE_CODE_THREE_PLUS || STREET_TYPE_LC.has(lc) || !correctStateToken(lc))
    ) {
      return t;
    }
  }
  return null;
}

interface LeadingParts {
  streetNumber: number | null;
  streetPrefix: string | null;
  /** Letter suffix from the token that produced streetNumber, e.g. "a" from
   *  "12a". Null when the number came from a pure-digit token or from a later
   *  token in a range pair. */
  numberSuffix: string | null;
}

function extractLeadingParts(tokens: string[]): LeadingParts {
  if (tokens.length === 0) {
    return { streetNumber: null, streetPrefix: null, numberSuffix: null };
  }

  const idx = skipFlatTypePrefix(tokens);
  const candidate = tokens[idx];
  if (!candidate) {
    return { streetNumber: null, streetPrefix: null, numberSuffix: null };
  }

  const pc = parseCandidate(candidate);

  if (pc.kind === "alphanum") {
    const num = Number(pc.value);
    const nextStr = tokens[idx + 1];
    if (nextStr && (PURE_DIGIT_RE.test(nextStr) || nextStr.includes("-"))) {
      // streetNumber comes from the next token (pure digit) — no suffix.
      const streetNum = nextStr.includes("-")
        ? Number(nextStr.split("-")[0])
        : Number(nextStr);
      return {
        streetNumber: streetNum,
        streetPrefix: findPrefixToken(tokens, idx + 2),
        numberSuffix: null,
      };
    }
    // streetNumber comes from this alphanumeric token — extract suffix.
    const suffixMatch = ALPHA_SUFFIX_RE.exec(candidate);
    return {
      streetNumber: num,
      streetPrefix: findPrefixToken(tokens, idx + 1),
      numberSuffix: suffixMatch?.[1] ?? null,
    };
  }

  if (pc.kind === "number") {
    const nextStr = tokens[idx + 1];
    if (nextStr && (PURE_DIGIT_RE.test(nextStr) || nextStr.includes("-"))) {
      const streetNum = nextStr.includes("-")
        ? Number(nextStr.split("-")[0])
        : Number(nextStr);
      return {
        streetNumber: streetNum,
        streetPrefix: findPrefixToken(tokens, idx + 2),
        numberSuffix: null,
      };
    }
    return {
      streetNumber: Number(pc.value),
      streetPrefix: findPrefixToken(tokens, idx + 1),
      numberSuffix: null,
    };
  }

  if (
    pc.kind === "alpha" &&
    !VALID_STATES_LC.has(pc.value) &&
    pc.value.length >= 1 &&
    (pc.value.length < STATE_CODE_THREE_PLUS ||
      STREET_TYPE_LC.has(pc.value) ||
      !correctStateToken(pc.value))
  ) {
    return { streetNumber: null, streetPrefix: pc.value, numberSuffix: null };
  }

  return { streetNumber: null, streetPrefix: null, numberSuffix: null };
}

function extractFlatNumber(tokens: string[]): number | null {
  const idx = skipFlatTypePrefix(tokens);
  const c = tokens[idx];
  if (!c) return null;
  const cleaned = c.replace(COMMA_STRIP_RE, "");
  if (PURE_DIGIT_RE.test(cleaned)) {
    const nextStr = tokens[idx + 1];
    if (nextStr && (PURE_DIGIT_RE.test(nextStr) || nextStr.includes("-"))) {
      return Number(cleaned);
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
//  Main entry point
// ──────────────────────────────────────────────────────────────────────────

/** Build an empty TokenizedQuery for queries that can never match an address
 *  (e.g. all-digit input). Returns an object with all nullable fields null. */
function makeEmptyTokenizedQuery(q: string, normalized: string, tokens: string[]): TokenizedQuery {
  return {
    raw: q,
    normalized,
    tokens,
    startsWithNumber: tokens[0] ? /^\d+$/.test(tokens[0]) : false,
    streetNumber: null,
    streetPrefix: null,
    localityPrefix: null,
    flatTypeAhead: false,
    flatNumber: null,
    correctedFrom: null,
    localityCorrectedFrom: null,
    stateCorrectedFrom: null,
    numberSuffix: null,
    streetTypeAbbrev: null,
  };
}

/** Stage 1: Normalise the raw query string into tokens. */
function tokenize(q: string): { normalized: string; tokens: string[] } {
  const normalized = q.trim().toLowerCase().replace(/,/g, "");
  const RANGE = "\u0000";
  const hyphenNormalized = normalized
    .replace(/(\d)-(\d)/g, `$1${RANGE}$2`)
    .replace(/-/g, " ")
    .replace(new RegExp(RANGE, "g"), "-");
  const tokens = hyphenNormalized.split(/[\s/]+/).filter(Boolean);
  return { normalized, tokens };
}

/** Stage 2: Classify tokens into address fields (pre-correction). */
function classify(tokens: string[]): TokenizedQuery {
  // Guard: all-digit queries → empty result.
  if (tokens.length > 0) {
    if (tokens.every((t) => PURE_DIGIT_RE.test(t))) {
      return makeEmptyTokenizedQuery("", "", tokens);
    }
    let consecutiveNumbers = 0;
    for (const t of tokens) {
      if (PURE_DIGIT_RE.test(t)) {
        consecutiveNumbers++;
        if (consecutiveNumbers >= 3) {
          return makeEmptyTokenizedQuery("", "", tokens);
        }
      } else {
        consecutiveNumbers = 0;
      }
    }
  }

  const startsWithNumber = !!tokens[0] && PURE_DIGIT_RE.test(tokens[0]);
  const flatTypeAhead = !!tokens[0] && FLAT_TYPE_LC.has(tokens[0]);
  const flatNumber = extractFlatNumber(tokens);
  const { streetNumber, streetPrefix, numberSuffix: leadingSuffix } = extractLeadingParts(tokens);

  const rawLast = tokens[tokens.length - 1];
  const lastToken = rawLast ? rawLast.replace(COMMA_STRIP_RE, "") : null;
  const localityPrefix: string | null =
    lastToken &&
    lastToken.length >= 2 &&
    !PURE_DIGIT_RE.test(lastToken) &&
    !/^\d+-\d+$/.test(lastToken) &&
    !VALID_STATES.has(lastToken.toUpperCase()) &&
    !STREET_TYPE_LC.has(lastToken) &&
    !isAlphanumericJunkToken(lastToken) &&
    (lastToken.length < STATE_CODE_THREE_PLUS || !correctStateToken(lastToken))
      ? lastToken
      : null;

  return {
    raw: "",
    normalized: "",
    tokens,
    startsWithNumber,
    streetNumber,
    streetPrefix,
    localityPrefix,
    flatTypeAhead,
    flatNumber,
    correctedFrom: null,
    localityCorrectedFrom: null,
    stateCorrectedFrom: null,
    numberSuffix: leadingSuffix,
    streetTypeAbbrev: null,
  };
}

/** Stage 3: Apply correctors to a classified query. */
function correct(
  result: TokenizedQuery,
  tokens: string[],
  q: string,
  normalized: string,
): TokenizedQuery {
  let streetPrefix = result.streetPrefix;
  let correctedFrom: string | null = null;

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

  let { localityPrefix } = result;
  let localityCorrectedFrom: string | null = null;

  localityPrefix = combineMultiWordLocality(localityPrefix, tokens);

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

  let stateCorrectedFrom: string | null = null;
  for (const token of tokens) {
    const lc = token.toLowerCase();
    if (VALID_STATES.has(token.toUpperCase())) break;
    if (lc.length < STATE_CODE_THREE_PLUS) continue;
    if (FLAT_TYPE_LC.has(lc) || STREET_TYPE_LC.has(lc)) continue;
    const corrected = correctStateToken(token);
    if (corrected) {
      stateCorrectedFrom = token;
      break;
    }
  }

  // numberSuffix was already extracted from the correct token by
  // extractLeadingParts() in classify() — pass through unchanged.
  const numberSuffix = result.numberSuffix;
  return {
    raw: q,
    normalized,
    tokens,
    startsWithNumber: result.startsWithNumber,
    streetNumber: result.streetNumber,
    streetPrefix,
    localityPrefix,
    flatTypeAhead: result.flatTypeAhead,
    flatNumber: result.flatNumber,
    correctedFrom,
    localityCorrectedFrom,
    stateCorrectedFrom,
    numberSuffix,
    streetTypeAbbrev: extractStreetTypeAbbrev(tokens),
  };
}

export function tokenizeQuery(q: string): TokenizedQuery {
  const { normalized, tokens } = tokenize(q);
  const classified = classify(tokens);

  // Only skip correction for queries that are all-digit or have 3+ consecutive
  // digit tokens — these are guaranteed to yield empty results and don't need
  // the correctors or state-correction / suffix processing.
  if (tokens.length > 0 && tokens.every((t) => PURE_DIGIT_RE.test(t))) {
    return makeEmptyTokenizedQuery(q, normalized, tokens);
  }
  if (tokens.length > 0) {
    let consecutive = 0;
    for (const t of tokens) {
      if (PURE_DIGIT_RE.test(t)) {
        consecutive++;
        if (consecutive >= 3) break;
      } else consecutive = 0;
    }
    if (consecutive >= 3) return makeEmptyTokenizedQuery(q, normalized, tokens);
  }

  return correct(classified, tokens, q, normalized);
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
