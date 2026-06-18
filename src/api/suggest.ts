import { Elysia, t } from "elysia";
import { routeQuery } from "../db/router";
import { buildSuggestKey, type CachedSuggestResponse, getSuggestCache } from "../lib/cache";
import { VALID_STATES } from "../lib/constants";
import { AppError, ERROR_CODES } from "../lib/errors";
import { logger } from "../lib/logger";
import { correctStateToken, isAlphanumericJunkToken } from "../search/tokenizer";

/** Strip characters that are not useful for address search while preserving address structure. */
export function sanitizeQuery(q: string): string {
  return q.replace(/[^a-zA-Z0-9\s\-',./]/g, "").trim();
}

/** Validate that a query looks like a plausible Australian address search.
 *  Rejects queries that cannot possibly match an address before they reach
 *  the tokenizer/DB. Rules:
 *   1. Pure 4-digit postcode ("2000") or bare range ("12-56") → always valid
 *   2. Must have at least one letter
 *   3. No 3+ consecutive digit-only tokens ("12 34 56 test")
 *   4. Minimum 2 meaningful characters (letters/digits, not just symbols)
 *   5. Must NOT be a pure state code ("nsw", "vic") — those return 0 results
 *      via trigram and are useless for autocomplete. State-only queries take
 *      500+ms if routed to a full state scan.
 *   6. No alphanumeric junk tokens like "12abc" — these force the router into
 *      tier2/tier4 trigram fallback and can take 15+ seconds.
 *   7. Single-token queries must be searchable on their own: a 4-digit
 *      postcode or an alphabetic token ≥2 chars. Bare numbers ("12", "99")
 *      and alphanumeric-with-no-street ("12a") need a street name to be
 *      meaningful — they're rejected here so the router never sees them.
 */
export function isValidAddressQuery(q: string): boolean {
  if (q.length === 0) return false;

  // 1. Pure 4-digit postcode or bare range is always valid
  if (/^\d{4}$/.test(q.trim())) return true;
  if (/^\d+-\d+$/.test(q.trim())) return true;

  // 2. Must have at least one letter
  if (!/[a-zA-Z]/.test(q)) return false;

  // 3. Pure state code is not useful for autocomplete
  if (VALID_STATES.has(q.trim().toUpperCase())) return false;

  // 4. No 3+ consecutive digit-only tokens.
  // Split on whitespace AND '/' to match tokenizeQuery's tokenization — this
  // prevents slash-delimited junk like "12abc/5" from bypassing the junk-token
  // guard (rule 6) while keeping legitimate slash patterns like "1/6" intact.
  const tokens = q.split(/[/\s]+/);
  let consecutiveDigitTokens = 0;
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      consecutiveDigitTokens++;
      if (consecutiveDigitTokens >= 3) return false;
    } else {
      consecutiveDigitTokens = 0;
    }
  }

  // 5. Minimum meaningful content
  const meaningful = q.replace(/[^a-zA-Z0-9]/g, "").length;
  if (meaningful < 2) return false;

  // 6. Reject alphanumeric junk tokens like "12abc" — these would force the
  // router into trigram fallback (tier2/tier4) over 16M rows. G-NAF street
  // numbers carry at most one trailing letter ("12", "12A"); a token with
  // 2+ trailing letters after digits cannot match a real AU address.
  for (const token of tokens) {
    if (isAlphanumericJunkToken(token)) return false;
  }

  // 7. Single-token queries must be searchable on their own. A bare number
  // ("12", "99") or alphanumeric-with-no-street ("12a", "21st") hits tier2
  // trigram fallback over 16M rows for no useful result — these need a
  // street name to be meaningful. AU postcodes are exactly 4 digits, so
  // a single-token query is searchable only if it is:
  //   - a 4-digit postcode ("2000")
  //   - an alphabetic token ≥2 chars (street name or locality)
  // Multi-token queries are handled by rules 1–6 plus the router itself,
  // which can combine a street number + street name into a fast tier1 query.
  if (tokens.length === 1) {
    const only = tokens[0] ?? "";
    const isPostcode = /^\d{4}$/.test(only);
    const isAlphabetic = /^[a-zA-Z]{2,}$/.test(only);
    if (!isPostcode && !isAlphabetic) return false;
  }

  return true;
}

const DEFAULT_LIMIT = 10;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const MAX_OFFSET = 1000;

interface SuggestParams {
  q: string;
  state: string | null;
  postcode: string | null;
  limit: number;
  offset: number;
  bypassCache: boolean;
  cacheKey: string;
}

interface ValidatedState {
  state: string | null;
  stateCorrectedFrom: string | null;
}

function parseSuggestParams(query: {
  q: string;
  state?: string;
  postcode?: string;
  limit?: string;
  offset?: string;
  no_cache?: string;
}): SuggestParams {
  const rawQ = query.q;
  const q = sanitizeQuery(rawQ);
  if (!isValidAddressQuery(q)) {
    throw new AppError(
      `Invalid query: "${rawQ}". Address queries must contain a street name, locality, or postcode.`,
      400,
      ERROR_CODES.VALIDATION_ERROR,
    );
  }
  const parsedLimit = Number.parseInt(query.limit ?? "", 10);
  const limit = Number.isNaN(parsedLimit)
    ? DEFAULT_LIMIT
    : Math.min(Math.max(parsedLimit, MIN_LIMIT), MAX_LIMIT);
  const parsedOffset = Number.parseInt(query.offset ?? "", 10);
  const offset = Number.isNaN(parsedOffset) ? 0 : Math.min(Math.max(parsedOffset, 0), MAX_OFFSET);
  const bypassCache = query.no_cache === "1" || query.no_cache === "true";
  const cacheKey = buildSuggestKey(q, query.state ?? null, query.postcode ?? null, limit);
  return {
    q,
    state: query.state ?? null,
    postcode: query.postcode ?? null,
    limit,
    offset,
    bypassCache,
    cacheKey,
  };
}

function validateStateParam(state: string | null): ValidatedState {
  if (state !== null) {
    const uc = state.toUpperCase();
    if (VALID_STATES.has(uc)) return { state: uc, stateCorrectedFrom: null };
    const corrected = correctStateToken(state);
    if (corrected) return { state: corrected, stateCorrectedFrom: state };
    throw new AppError(
      `Invalid state: "${state}". Must be one of: ACT, NSW, NT, QLD, SA, TAS, VIC, WA, OT.`,
      400,
      ERROR_CODES.VALIDATION_ERROR,
    );
  }
  return { state: null, stateCorrectedFrom: null };
}

interface SuggestResponseBody {
  results: Array<{
    id: string;
    display: string;
    locality: string;
    lat: number | null;
    lon: number | null;
    state: string;
    postcode: string;
    score: number;
  }>;
  tier: string;
  took_ms: number;
  cache_status: "hit" | "miss";
  corrected_from?: string;
  locality_corrected_from?: string;
  state_corrected_from?: string;
}

function formatSuggestResponse(
  rows: Array<Record<string, unknown>>,
  router: {
    tier: string;
    correctedFrom?: string;
    localityCorrectedFrom?: string;
    stateCorrectedFrom?: string;
  },
  tookMs: number,
  stateCorrectedFrom: string | null,
): SuggestResponseBody {
  const body: SuggestResponseBody = {
    results: rows.map((r) => ({
      id: String(r.address_detail_pid ?? ""),
      display: String(r.display ?? ""),
      locality: String(r.locality ?? ""),
      lat: r.lat != null ? Number(r.lat) : null,
      lon: r.lon != null ? Number(r.lon) : null,
      state: String(r.state ?? ""),
      postcode: String(r.postcode ?? ""),
      score: Number(r.sim ?? r.rank ?? r.confidence_norm ?? 0),
    })),
    tier: router.tier,
    took_ms: tookMs,
    cache_status: "miss" as const,
  };
  if (router.correctedFrom) body.corrected_from = router.correctedFrom;
  if (router.localityCorrectedFrom) body.locality_corrected_from = router.localityCorrectedFrom;
  const mergedStateCorrected = stateCorrectedFrom ?? router.stateCorrectedFrom;
  if (mergedStateCorrected) body.state_corrected_from = mergedStateCorrected;
  return body;
}

const timingWindow: number[] = [];
const TIMING_LOG_INTERVAL = 100;

function recordTiming(tookMs: number): void {
  timingWindow.push(tookMs);
  if (timingWindow.length >= TIMING_LOG_INTERVAL) {
    const sorted = [...timingWindow].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    logger.info({ p50, p95, p99, avg: Math.round(avg), count: sorted.length }, "suggest_stats");
    timingWindow.length = 0;
  }
}

export function resetTimingWindow(): void {
  timingWindow.length = 0;
}

export const suggestRoute = new Elysia().get(
  "/suggest",
  async ({ query, set: set2 }) => {
    const start = performance.now();
    const cache = getSuggestCache();

    const {
      q,
      state: rawState,
      postcode,
      limit,
      offset,
      bypassCache,
      cacheKey,
    } = parseSuggestParams(query);
    const { state, stateCorrectedFrom } = validateStateParam(rawState);

    if (!bypassCache && offset === 0) {
      const cached = cache.get(cacheKey);
      if (cached) {
        const result: SuggestResponseBody = {
          results: cached.results,
          tier: cached.tier,
          took_ms: Math.round(performance.now() - start),
          cache_status: "hit",
        };
        if (cached.corrected_from) result.corrected_from = cached.corrected_from;
        if (cached.locality_corrected_from)
          result.locality_corrected_from = cached.locality_corrected_from;
        if (cached.state_corrected_from) result.state_corrected_from = cached.state_corrected_from;
        return result;
      }
    }

    const router = await routeQuery(q, state ?? null, postcode ?? null, limit, offset);
    const rows: Array<Record<string, unknown>> = await router.sql;
    const tookMs = Math.round(performance.now() - start);

    set2.headers["Cache-Control"] = "public, max-age=30";

    logger.info(
      { q, sanitized: q !== query.q, tier: router.tier, count: rows.length, tookMs, offset },
      "suggest",
    );

    recordTiming(tookMs);

    const body = formatSuggestResponse(rows, router, tookMs, stateCorrectedFrom);

    if (!bypassCache && offset === 0) {
      cache.set(cacheKey, { ...body, cached_at: Date.now() } as CachedSuggestResponse);
    }

    return body;
  },
  {
    query: t.Object({
      q: t.String({
        minLength: 2,
        maxLength: 200,
        description:
          "Partial address to search for. Supports street numbers, street names, locality names, postcodes, and state abbreviations. Typo-tolerant via trigram matching.",
        example: "12 main st sydney",
      }),
      state: t.Optional(
        t.String({
          description:
            "Filter results to a single state or territory. One of: ACT, NSW, NT, OT, QLD, SA, TAS, VIC, WA.",
          example: "NSW",
        }),
      ),
      postcode: t.Optional(
        t.String({
          pattern: "^\\d{4}$",
          description: "Filter results to a specific postcode. Must be exactly 4 digits.",
          example: "2000",
        }),
      ),
      limit: t.Optional(
        t.String({
          description:
            "Maximum number of results to return. Clamped between 1 and 50. Defaults to 10.",
          example: "10",
        }),
      ),
      offset: t.Optional(
        t.String({
          description: "Number of results to skip for pagination. Max 1000. Defaults to 0.",
          example: "0",
        }),
      ),
      no_cache: t.Optional(
        t.String({
          description:
            'Set to "1" or "true" to bypass the in-process LRU cache. Used by benchmarks for accurate latency measurements.',
          example: "1",
        }),
      ),
    }),
    response: t.Object({
      results: t.Array(
        t.Object({
          id: t.String({
            description: "G-NAF persistent identifier for this address.",
            example: "GANSW706063331",
          }),
          display: t.String({
            description: "Formatted Australian address string.",
            example: "1 ALFRED ST, SYDNEY NSW 2000",
          }),
          locality: t.String({
            description: "Suburb / locality name.",
            example: "SYDNEY",
          }),
          lat: t.Nullable(
            t.Number({ description: "Latitude in GDA2020 datum (null if no geocode)." }),
          ),
          lon: t.Nullable(
            t.Number({ description: "Longitude in GDA2020 datum (null if no geocode)." }),
          ),
          state: t.String({ description: "State or territory abbreviation.", example: "NSW" }),
          postcode: t.String({ description: "Australian postcode (4 digits).", example: "2000" }),
          score: t.Number({
            description:
              "Relevance score: similarity × (1 + ln(confidenceNorm + 1)). " +
              "similarity (0-1) is trigram text match (1.0 for btree tiers). " +
              "confidenceNorm normalises G-NAF CONFIDENCE (6→1.0, 0→0.14, NULL→0.5). " +
              "Range: 0 to ~1.69. Higher = more relevant.",
            example: 0.43,
          }),
        }),
      ),
      tier: t.String({
        description: "Query execution tier used to resolve this request.",
        example: "tier1",
      }),
      took_ms: t.Number({
        description: "Server-side query execution time in ms (excludes network).",
        example: 12,
      }),
      cache_status: t.Optional(
        t.String({
          description:
            'Cache indicator: "hit" when response came from in-process LRU, "miss" when freshly computed.',
          example: "miss",
        }),
      ),
      corrected_from: t.Optional(
        t.String({
          description:
            'Original street prefix when the in-memory corrector rewrote it (e.g. "gresfodr" → "gresford").',
          example: "gresfodr",
        }),
      ),
      locality_corrected_from: t.Optional(
        t.String({
          description:
            'Original locality prefix when the locality corrector rewrote it (e.g. "wntirna" → "wantirna").',
          example: "wntirna",
        }),
      ),
      state_corrected_from: t.Optional(
        t.String({
          description:
            'Original state code when the state corrector rewrote it (e.g. "nswq" → "NSW"). Originates from either a query token or the ?state= param.',
          example: "nswq",
        }),
      ),
    }),
    detail: {
      tags: ["Search"],
      summary: "Address autocomplete suggestions",
      description:
        "Returns ranked Australian address suggestions matching the query.\n\n" +
        "**Authentication**: Requires `X-API-Key` header with a valid domain-verified API key.\n" +
        "The `Origin` and `Referer` headers must match the key's registered domain when present (browser clients).\n\n" +
        "**Pagination**: Use `offset` to page through results. `limit` caps page size (max 50). `offset` max 1000.\n" +
        "**Tiers**: Postcode (<1ms), Street number (<5ms), Street prefix (<10ms), Typo-tolerant (<50ms).\n\n" +
        "Over 16 million Australian addresses from the Geoscape Australia G-NAF dataset.\n" +
        "G-NAF © Geoscape Australia",
    },
  },
);
