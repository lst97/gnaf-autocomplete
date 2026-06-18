import { getSql } from "./client";

/**
 * Lazily-initialised connection reference. Module-level `getSql()` is
 * unsafe when tests run in parallel because another test file may have
 * mutated `process.env` (e.g. config.test.ts).  Deferring to first call
 * ensures the correct DATABASE_URL is in effect.
 */
let _sql: ReturnType<typeof getSql> | null = null;
function sql(): ReturnType<typeof getSql> {
  if (!_sql) _sql = getSql();
  return _sql;
}

/**
 * Tier 0c: btree on (state, number_first) — <1ms.
 * ORDER BY confidence_norm DESC only (no display tiebreaker). The composite
 * index (state, number_first, confidence_norm DESC) lets the planner do an
 * Index Only Scan with LIMIT 10 — no sort needed.
 */
export function tier0NumberQuery(state: string, number: number, limit: number, offset = 0) {
  return sql()`
    SELECT address_detail_pid, display, locality, lat, lon, state, postcode, confidence_norm
    FROM address_search_mv
    WHERE state = ${state}
      AND number_first = ${number}
    ORDER BY confidence_norm DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

/**
 * Tier 0: btree equality on (state, postcode) — <1ms.
 */
export function tier0Query(state: string, postcode: string | null, limit: number, offset = 0) {
  if (postcode) {
    return sql()`
      SELECT address_detail_pid, display, locality, lat, lon, state, postcode, confidence_norm
      FROM address_search_mv
      WHERE state = ${state}
        AND postcode = ${postcode}
      ORDER BY confidence_norm DESC, display
      LIMIT ${limit}
      OFFSET ${offset}
    `;
  }
  return sql()`
    SELECT address_detail_pid, display, locality, lat, lon, state, postcode, confidence_norm
    FROM address_search_mv
    WHERE state = ${state}
    ORDER BY confidence_norm DESC, display
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

/**
 * Tier 0b: btree on (state, locality_lc text_pattern_ops) — <5ms.
 */
export function tier0LocalityQuery(
  state: string,
  localityPrefix: string,
  limit: number,
  offset = 0,
) {
  return sql()`
    SELECT address_detail_pid, display, locality, lat, lon, state, postcode, confidence_norm
    FROM address_search_mv
    WHERE state = ${state}
      AND locality_lc LIKE ${`${localityPrefix}%`}
    ORDER BY confidence_norm DESC, display
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

/**
 * Tier 1: btree prefix on lower(street) text_pattern_ops — 1-3ms.
 * If numberFirst is provided, exact street-number matches are boosted to the
 * top via ORDER BY (rather than filtering). This ensures "unit 1 6 fortuna"
 * still finds "UNIT 1, 1 FORTUNA ST" — the number is a relevance signal, not
 * an absolute filter.
 */
export function tier1StreetQuery(
  streetPrefix: string,
  state: string | null,
  locale: string | null,
  limit: number,
  offset = 0,
  numberFirst: number | null = null,
  flatTypeAhead = false,
  postcode: string | null = null,
  flatNumber: number | null = null,
  streetType: string | null = null,
  numberSuffix: string | null = null,
) {
  const conditions: string[] = ["street_lc LIKE $1"];
  const params: (string | number)[] = [`${streetPrefix}%`];
  let nextIdx = 2;
  let orderClause = "confidence_norm DESC, display";

  // Add boosts in REVERSE priority order (each prepends). The last-prepended
  // clause has highest ORDER BY priority, so the most specific boost goes last:
  //   1. number match (most specific)
  //   2. exact number in display text
  //   3. flat number in display text
  //   4. flat type prefix (least specific boost)

  if (flatTypeAhead) {
    orderClause =
      `(lower(display) LIKE 'unit %' OR lower(display) LIKE 'flat %' OR lower(display) LIKE 'apt %' OR lower(display) LIKE 'shop %') DESC, ` +
      orderClause;
  }

  if (streetType != null) {
    // Boost entries matching the street type suffix (e.g., "ST" over "CL").
    // Display format: "UNIT 1, 6 FORTUNA ST, CLAYTON VIC 3168".
    params.push(` ${streetType}`);
    orderClause = `(strpos(lower(display), $${nextIdx}) > 0) DESC, ${orderClause}`;
    nextIdx++;
  }

  if (flatNumber != null) {
    params.push(`unit ${flatNumber},`);
    orderClause = `(strpos(lower(display), $${nextIdx}) > 0) DESC, ${orderClause}`;
    nextIdx++;
  }

  if (numberFirst != null) {
    params.push(numberFirst);
    orderClause = `(number_first IS NOT NULL AND number_first = $${nextIdx}) DESC, ${orderClause}`;
    nextIdx++;
    // Boost exact number matches over ranges.
    params.push(`${String(numberFirst)} `);
    orderClause = `(strpos(lower(display), $${nextIdx}) > 0) DESC, ${orderClause}`;
    nextIdx++;
    // For alphanumeric numbers ("6a", "14b"), boost the exact display-text
    // match ("6A ALBERT AV") over the plain number ("6 ALBERT AV").
    if (numberSuffix) {
      params.push(`${String(numberFirst)}${numberSuffix} `);
      orderClause = `(strpos(lower(display), $${nextIdx}) > 0) DESC, ${orderClause}`;
      nextIdx++;
    }
  }

  if (locale) {
    // Use locality as a boost (ORDER BY) rather than a filter (WHERE) to
    // handle multi-word localities like "clayton south" where only "south"
    // is the detected suffix — the filter would miss "clayton south".
    params.push(`${locale}%`);
    orderClause = `(locality_lc LIKE $${nextIdx}) DESC, ${orderClause}`;
    nextIdx++;
  }
  // When both state and postcode are known from the query, add postcode as a
  // filter (not just a boost). The user explicitly entered it — they want that
  // specific postcode. State goes first since it's in the index INCLUDE.
  if (state) {
    conditions.push(`state = $${nextIdx}`);
    params.push(state);
    nextIdx++;
  }
  if (postcode && state) {
    conditions.push(`postcode = $${nextIdx}`);
    params.push(postcode);
    nextIdx++;
  }
  params.push(limit);
  const limitIdx = nextIdx;
  nextIdx++;
  params.push(offset);
  const offsetIdx = nextIdx;

  return sql().unsafe(
    `
    SELECT address_detail_pid, display, locality, lat, lon, state, postcode, confidence_norm
    FROM address_search_mv
    WHERE ${conditions.join(" AND ")}
    ORDER BY ${orderClause}
    LIMIT $${limitIdx}
    OFFSET $${offsetIdx}
  `,
    // biome-ignore lint/suspicious/noExplicitAny: Bun.sql unsafe() accepts any[]
    params as any,
  );
}

/**

/**
 * Tier 2: GIN trigram on search_text_expanded — 10-30ms.
 * Uses DISTINCT ON (display) for deduplication.
 * For short queries (≤3 chars), the similarity threshold is skipped
 * (the ORDER BY LIMIT is sufficient to filter noise).
 */
export function tier2TrigramQuery(
  query: string,
  state: string | null,
  postcode: string | null,
  limit: number,
  offset = 0,
) {
  const shortQ = query.length <= 3;
  const conditions = shortQ ? ["search_text_expanded % $1"] : ["search_text_expanded % $1"];
  // $1 = query for trigram match; $2 = "${query}%" for locality prefix boost.
  // Boosts results whose locality starts with the query — e.g. "sydne"
  // surfaces "Sydney" addresses above "Sydenham" or "Sylvania".
  const params: (string | number)[] = [query, `${query}%`];
  let paramIdx = 3;
  if (state) {
    conditions.push(`state = $${paramIdx}`);
    params.push(state);
    paramIdx++;
  }
  if (postcode) {
    conditions.push(`postcode = $${paramIdx}`);
    params.push(postcode);
    paramIdx++;
  }
  params.push(limit);
  params.push(offset);

  const where = conditions.join(" AND ");
  return sql().unsafe(
    `
    SELECT DISTINCT ON (display)
      address_detail_pid, display, locality, lat, lon, state, postcode, confidence_norm,
      similarity(search_text_expanded, $1) AS sim
    FROM address_search_mv
    WHERE ${where}
    ORDER BY
      display,
      (locality_lc LIKE $2) DESC,
      similarity(search_text_expanded, $1) * (1 + ln(confidence_norm + 1)) DESC
    LIMIT $${paramIdx}
    OFFSET $${paramIdx + 1}
  `,
    // biome-ignore lint/suspicious/noExplicitAny: Bun.sql unsafe() accepts any[]
    params as any,
  );
}

/**

/**
 * Tier 4: Multi-word fuzzy — uses GIN trigrams on street_lc and locality_lc
 * (NOT search_text_expanded) so the candidate set stays small. "ab" against
 * search_text_expanded matches 5M+ rows; "ab" against street_lc matches only
 * addresses whose street starts with "ab".
 */
export function tier4MultiWordQuery(
  query: string,
  state: string | null,
  _postcode: string | null,
  limit: number,
  offset = 0,
) {
  const allWords = query.split(/\s+/).filter(Boolean);
  if (allWords.length < 2) {
    return tier2TrigramQuery(query, state, _postcode, limit, offset);
  }

  const longWords = allWords.filter((w) => w.length >= 3);
  if (longWords.length === 0) {
    return tier2TrigramQuery(query, state, _postcode, limit, offset);
  }

  longWords.sort((a, b) => b.length - a.length);
  const topWords = longWords.slice(0, 2);

  // GREATEST per-word because we don't know which column matched.
  const wordScoreExprs = topWords.map((_, i) => {
    const p = i + 1;
    return `GREATEST(similarity(street_lc, $${p}), similarity(locality_lc, $${p}))`;
  });
  const scoreExpr =
    topWords.length === 1 ? wordScoreExprs[0] : `(${wordScoreExprs.join(" + ")}) / 2`;

  const conditions = [`(street_lc % $1 OR locality_lc % $1)`];
  const params: (string | number)[] = [...topWords];
  let nextIdx = topWords.length + 1;
  if (state) {
    conditions.push(`state = $${nextIdx}`);
    params.push(state);
    nextIdx++;
  }
  params.push(limit);
  const limitIdx = nextIdx;
  nextIdx++;
  params.push(offset);
  const offsetIdx = nextIdx;

  const where = conditions.join(" AND ");
  // LIMIT 8000 before DISTINCT ON — sorts 200K+ rows for common words like
  // "melbourne"; capping keeps the sort under 200ms without losing top results.
  return sql().unsafe(
    `
    SELECT DISTINCT ON (display)
      address_detail_pid, display, lat, lon, state, postcode, confidence_norm,
      sim
    FROM (
      SELECT address_detail_pid, display, lat, lon, state, postcode, confidence_norm,
        ${scoreExpr} AS sim
      FROM address_search_mv
      WHERE ${where}
      ORDER BY ${scoreExpr} DESC
      LIMIT 8000
    ) candidates
    ORDER BY display, sim * (1 + ln(confidence_norm + 1)) DESC
    LIMIT $${limitIdx}
    OFFSET $${offsetIdx}
  `,
    // biome-ignore lint/suspicious/noExplicitAny: Bun.sql unsafe() accepts any[]
    params as any,
  );
}

/**
 * Postcode prefix: btree on (postcode text_pattern_ops) — <1ms.
 * Used when query is purely numeric and 2-4 digits.
 * For 4-digit prefixes (full postcode), use exact equality — the btree
 * index can do a direct Index Cond scan without the LIKE range scan +
 * recheck filter, saving ~7ms per query.
 */
export function tierPostcodeQuery(postcodePrefix: string, limit: number, offset = 0) {
  if (postcodePrefix.length === 4) {
    return sql()`
      SELECT address_detail_pid, display, locality, lat, lon, state, postcode, confidence_norm
      FROM address_search_mv
      WHERE postcode = ${postcodePrefix}
      ORDER BY confidence_norm DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
  }
  return sql()`
    SELECT address_detail_pid, display, locality, lat, lon, state, postcode, confidence_norm
    FROM address_search_mv
    WHERE postcode LIKE ${`${postcodePrefix}%`}
    ORDER BY confidence_norm DESC, display
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}
