import {
  detectPostcodeFilter,
  detectStateFilter,
  STREET_TYPE_LC,
  tokenizeQuery,
} from "../search/tokenizer";
import { getSql } from "./client";

const STREET_TYPE_ABBREV: Record<string, string> = {
  st: "st",
  street: "st",
  rd: "rd",
  road: "rd",
  dr: "dr",
  drive: "dr",
  cl: "cl",
  close: "cl",
  ct: "ct",
  court: "ct",
  av: "av",
  ave: "av",
  avenue: "av",
  pl: "pl",
  place: "pl",
  ln: "ln",
  lane: "ln",
  cr: "cr",
  cres: "cr",
  crescent: "cr",
  pde: "pde",
  parade: "pde",
  tce: "tce",
  terrace: "tce",
  cct: "cct",
  circuit: "cct",
  hwy: "hwy",
  highway: "hwy",
  gr: "gr",
  grove: "gr",
  bvd: "bvd",
  blvd: "bvd",
  boulevard: "bvd",
  pkwy: "pkwy",
  parkway: "pkwy",
  esp: "esp",
  esplanade: "esp",
  trl: "trl",
  trail: "trl",
  tk: "tk",
  track: "tk",
};

import {
  tier0LocalityQuery,
  tier0NumberQuery,
  tier0Query,
  tier1StreetQuery,
  tier2TrigramQuery,
  tier4MultiWordQuery,
  tierPostcodeQuery,
} from "./queries";

export interface RouterResult {
  sql: ReturnType<
    | typeof tier0Query
    | typeof tier0NumberQuery
    | typeof tier0LocalityQuery
    | typeof tier1StreetQuery
    | typeof tier2TrigramQuery
    | typeof tierPostcodeQuery
    | typeof tier4MultiWordQuery
  >;
  tier:
    | "tier0"
    | "tier0_number"
    | "tier0_locality"
    | "tier1"
    | "typo_corrected"
    | "tier2"
    | "postcode"
    | "tier4";
  /**
   * Original (uncorrected) street prefix, when the corrector rewrote it.
   * Lets the API surface "did you mean …" hints to the client.
   */
  correctedFrom?: string;
  /** Original (pre-correction) locality prefix, when the locality corrector fired. */
  localityCorrectedFrom?: string;
  /** Original (pre-correction) state-code token, when the state corrector fired. */
  stateCorrectedFrom?: string;
}

/**
 * Smart query router: picks the cheapest index that works for the given query.
 *
 * Decision tree:
 * 1. Has state + postcode filter → Tier 0 (btree equality, <1ms)
 * 2. Query is purely numeric (2-4 digits) → Postcode prefix (btree, <1ms)
 * 3. Has state + street number → Tier 0c (btree number_first, <1ms)
 * 4. Has state + locality prefix → Tier 0b (btree locality, <5ms)
 * 5. Has street prefix → Tier 1 (btree street, 1-3ms). The tokeniser may have
 *    silently rewritten the street prefix via the in-memory BK-tree corrector
 *    (e.g. "gresfodr" → "gresford"); the original is preserved in
 *    `correctedFrom` and the tier label becomes `typo_corrected` so the API
 *    can show "Did you mean GRESFORD?" hints.
 * 6. Otherwise → Tier 2 (GIN trigram, 10-30ms) or Tier 4 (multi-word).
 */
export function routeQuery(
  q: string,
  state: string | null,
  postcode: string | null,
  limit: number,
  offset: number = 0,
): RouterResult {
  const tokenized = tokenizeQuery(q);

  const effectiveState = state ?? detectStateFilter(tokenized);
  const effectivePostcode = postcode ?? detectPostcodeFilter(tokenized);

  // Short-circuit: queries with no extractable address content (e.g. all
  // digits like "12 34 56 78") can never match an address. Return an empty
  // result set immediately instead of falling to tier4 trigram which
  // matches millions of rows containing any of those digit sequences.
  if (
    !tokenized.streetPrefix &&
    !tokenized.streetNumber &&
    !tokenized.localityPrefix &&
    !effectiveState &&
    !effectivePostcode
  ) {
    return {
      sql: getSql()`SELECT * FROM address_search_mv WHERE FALSE LIMIT 0`,
      tier: "tier2",
    };
  }

  // Tier 0: state+postcode equality (<1ms, small result set)
  // Skip when the query has 5+ tokens AND a street prefix — the user entered
  // a full address (street + locality + state + postcode), not a short
  // locality search like "sydney nsw 2000" (3 tokens).
  const prefix = tokenized.streetPrefix;
  const hasFullAddress = prefix && prefix.length >= 3 && tokenized.tokens.length >= 5;

  const correctionFields: { localityCorrectedFrom?: string; stateCorrectedFrom?: string } = {};
  if (tokenized.localityCorrectedFrom)
    correctionFields.localityCorrectedFrom = tokenized.localityCorrectedFrom;
  if (tokenized.stateCorrectedFrom)
    correctionFields.stateCorrectedFrom = tokenized.stateCorrectedFrom;

  if (effectiveState && effectivePostcode && !hasFullAddress) {
    return {
      sql: tier0Query(effectiveState, effectivePostcode, limit, offset),
      tier: "tier0",
      ...correctionFields,
    };
  }

  // Postcode prefix: purely numeric query, 2-4 digits (<1ms via btree)
  const normalizedQ = q.trim().replace(/\s+/g, "");
  if (/^\d{2,4}$/.test(normalizedQ)) {
    return {
      sql: tierPostcodeQuery(normalizedQ, limit, offset),
      tier: "postcode",
      ...correctionFields,
    };
  }

  // Tier 0c: state + street number (<1ms)
  if (effectiveState && tokenized.streetNumber !== null && !hasFullAddress) {
    return {
      sql: tier0NumberQuery(effectiveState, tokenized.streetNumber, limit, offset),
      tier: "tier0_number",
      ...correctionFields,
    };
  }

  // Tier 0b: state + locality prefix (<5ms)
  if (effectiveState && tokenized.localityPrefix && tokenized.localityPrefix.length >= 2) {
    return {
      sql: tier0LocalityQuery(effectiveState, tokenized.localityPrefix, limit, offset),
      tier: "tier0_locality",
      ...correctionFields,
    };
  }

  // Multi-word locality boost: tokenizer captures only the last word as
  // localityPrefix. When the second-to-last token is alphabetic and not a
  // street type, combine both — covers "glen huntly", "mount waverley", etc.
  let locale = tokenized.localityPrefix;
  const toks = tokenized.tokens;
  if (locale && toks.length >= 2) {
    const penultimate = toks[toks.length - 2];
    if (penultimate && /^[a-z]{2,}$/.test(penultimate) && !STREET_TYPE_LC.has(penultimate)) {
      locale = `${penultimate} ${locale}`;
    }
  }

  let streetAbbrev: string | null = null;
  for (const t of tokenized.tokens) {
    const lc = t.replace(/^,+|,+$/g, "").toLowerCase();
    if (STREET_TYPE_LC.has(lc) && STREET_TYPE_ABBREV[lc]) {
      streetAbbrev = `${STREET_TYPE_ABBREV[lc] ?? ""},`;
      break;
    }
  }

  // Tier 1: exact street prefix (1-3ms). Supports ≥1-char prefixes so
  // 1-2 char streets like "Y ST" / "PI ST" hit the fast btree index.
  if (prefix && prefix.length >= 1) {
    return {
      sql: tier1StreetQuery(
        prefix,
        effectiveState,
        locale,
        limit,
        offset,
        tokenized.streetNumber,
        tokenized.flatTypeAhead,
        effectivePostcode,
        tokenized.flatNumber,
        streetAbbrev,
      ),
      tier: tokenized.correctedFrom ? "typo_corrected" : "tier1",
      ...(tokenized.correctedFrom != null ? { correctedFrom: tokenized.correctedFrom } : {}),
      ...correctionFields,
    };
  }

  // Tier 4: multi-word fuzzy (for 2+ word queries, per-word scoring)
  if (tokenized.tokens.length >= 2) {
    return {
      sql: tier4MultiWordQuery(
        tokenized.normalized,
        effectiveState,
        effectivePostcode,
        limit,
        offset,
      ),
      tier: "tier4",
      ...correctionFields,
    };
  }

  // Tier 2: trigram fuzzy (fallback for single-word, 10-30ms)
  return {
    sql: tier2TrigramQuery(tokenized.normalized, effectiveState, effectivePostcode, limit, offset),
    tier: "tier2",
    ...correctionFields,
  };
}
