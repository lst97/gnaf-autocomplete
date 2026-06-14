import { Elysia, t } from "elysia";
import { routeQuery } from "../db/router";
import { buildSuggestKey, type CachedSuggestResponse, getSuggestCache } from "../lib/cache";
import { AppError, ERROR_CODES } from "../lib/errors";
import { logger } from "../lib/logger";
import { correctStateToken } from "../search/tokenizer";

const VALID_STATES = new Set(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA", "OT"]);

/** Strip characters that are not useful for address search while preserving address structure. */
function sanitizeQuery(q: string): string {
  return q.replace(/[^a-zA-Z0-9\s\-',./]/g, "").trim();
}

// Rolling timing stats
const timingWindow: number[] = [];
const TIMING_LOG_INTERVAL = 100;

export const suggestRoute = new Elysia().get(
  "/suggest",
  async ({ query, set: set2 }) => {
    const start = performance.now();
    const cache = getSuggestCache();

    const {
      q: rawQ,
      state: rawState,
      postcode,
      limit: limitStr,
      offset: offsetStr,
      no_cache,
    } = query;
    const q = sanitizeQuery(rawQ);
    const limit = Math.min(Math.max(parseInt(limitStr ?? "10", 10) || 10, 1), 50);
    const offset = Math.min(Math.max(parseInt(offsetStr ?? "0", 10) || 0, 0), 1000);
    const bypassCache = no_cache === "1" || no_cache === "true";

    // State param correction: if provided, try exact match → unique-1-edit correction → 400.
    let state = rawState ?? null;
    let stateCorrectedFrom: string | null = null;
    if (state != null) {
      const uc = state.toUpperCase();
      if (VALID_STATES.has(uc)) {
        state = uc; // exact match, use as-is
      } else {
        const corrected = correctStateToken(state);
        if (corrected) {
          stateCorrectedFrom = state;
          state = corrected; // silent correction, UI will see state_corrected_from
        } else {
          throw new AppError(
            `Invalid state: "${state}". Must be one of: ACT, NSW, NT, QLD, SA, TAS, VIC, WA, OT.`,
            400,
            ERROR_CODES.VALIDATION_ERROR,
          );
        }
      }
    }

    // Check cache (only for first-page results, never for pagination)
    if (!bypassCache && offset === 0) {
      const cacheKey = buildSuggestKey(q, state ?? null, postcode ?? null, limit);
      const cached = cache.get(cacheKey);
      if (cached) {
        return {
          results: cached.results,
          tier: cached.tier,
          took_ms: cached.took_ms,
          cache_status: "hit" as const,
          corrected_from: cached.corrected_from,
          locality_corrected_from: cached.locality_corrected_from,
          state_corrected_from: cached.state_corrected_from,
        };
      }
    }

    const router = await routeQuery(q, state ?? null, postcode ?? null, limit, offset);
    const rows: Array<Record<string, unknown>> = await router.sql;
    const tookMs = Math.round(performance.now() - start);

    set2.headers["Cache-Control"] = "public, max-age=30";

    logger.info(
      { q, sanitized: q !== rawQ, tier: router.tier, count: rows.length, tookMs, offset },
      "suggest",
    );

    // Rolling timing stats
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

    const body: Record<string, unknown> = {
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

    // Surface correction tracking (only when a correction was applied)
    if (router.correctedFrom) body.corrected_from = router.correctedFrom;
    if (router.localityCorrectedFrom) body.locality_corrected_from = router.localityCorrectedFrom;
    if (router.stateCorrectedFrom) body.state_corrected_from = router.stateCorrectedFrom;
    // Also surface param-based state correction (set in the handler, not the router)
    if (stateCorrectedFrom) body.state_corrected_from = stateCorrectedFrom;

    // Populate cache (only for first-page, never when bypass is requested)
    if (!bypassCache && offset === 0) {
      const cacheKey = buildSuggestKey(q, state ?? null, postcode ?? null, limit);
      cache.set(cacheKey, { ...body, cached_at: Date.now() } as CachedSuggestResponse);
    }

    // biome-ignore lint/suspicious/noExplicitAny: Elysia type system expects Response; returning a plain object is valid
    return body as any;
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
              "Relevance score: similarity × (1 + ln(confidence + 1)). Higher = more relevant.",
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
