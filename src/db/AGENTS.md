# src/db

PostgreSQL client + 7-tier query router. The performance heart of the system.

## OVERVIEW
postgres.js singleton + hand-tuned SQL for each query shape. The router picks
the cheapest viable index per query (hardcoded decision tree, not cost-based).

## STRUCTURE
| File | Purpose |
|------|---------|
| `client.ts` | postgres.js singleton (`getSql()`) |
| `queries.ts` | Per-tier query functions: tier0/0b/0c/1/2/4 + postcode + typo_corrected |
| `router.ts` | `routeQuery(q, state, postcode, limit, offset)` decision tree |

## WHERE TO LOOK
- **Add new tier**: new function in `queries.ts` returning `sql\`...\``; add branch in `router.ts` decision tree
- **Modify scoring**: edit SQL `ORDER BY` clause; formula is `similarity * (1 + ln(confidence_norm + 1))`
- **Add boost**: use `strpos(lower(display), $N) > 0` for display-text substring matches

## 7-TIER ROUTER (6 tiers + typo_corrected)
| Tier | Trigger | Index |
|------|---------|-------|
| `tier0_locality` | state + locality prefix ≥2 chars | btree `(state, locality_lc text_pattern_ops)` |
| `tier1` | alphabetic token ≥1 char that looks like a street name | btree `(street_lc text_pattern_ops, confidence_norm DESC)` |
| `tier0` | state + postcode (no full address) | btree `(state, postcode)` |
| `postcode` | purely numeric 2-4 digit | btree `(postcode text_pattern_ops)` |
| `tier4` | 2+ tokens, no prefix (rare) | per-word trigram on `street_lc` + `locality_lc` |
| `tier2` | single-word fallback | GIN trigram on `search_text_expanded` |
| `tier0_number` | state + street number | btree `(state, number_first)` |
| `typo_corrected` | SymSpell corrector rewrites → tier1 | (corrector runs before DB query) |

## CONVENTIONS — SQL IDIOMS
- **`text_pattern_ops`** mandatory on btree prefix columns (`locality_lc`, `street_lc`, `postcode`)
- **`DISTINCT ON (display)`** in tier 2/4 for deduplication
- **`similarity(col, $1) > 0.3`** in WHERE to filter trigram noise
- **`ln()` not `log()`** — natural log in the confidence boost formula
- **`%` operator** from `pg_trgm` for trigram matching
- `sql.unsafe()` for dynamic queries with `$$N` placeholders

## ANTI-PATTERNS
- **NEVER** add a tier without first checking `pg_class.reltuples` style latency targets
- **NEVER** use `ILIKE` — use `LIKE` with `text_pattern_ops` btree OR `%` trigram operator
- **NEVER** call `count(*)` on `address_search_mv` — use `pg_class.reltuples`
- **NEVER** skip the `idempotent` warmup
- **NEVER** query the DB directly from route handlers — use `src/sql/` modules

## GOTCHAS
- `hasFullAddress` gate: skips tier 0/0c when query has ≥5 tokens AND a street prefix
- **Tier 1 prefix threshold is ≥1 char** (lowered from 3) — `"ab"`, `"xy"`, `"ab cd sydney"` all route to tier1, not tier2/tier4
- State set includes `OT` (Other Territories)
- Tier 3 (GIN tsvector FTS) was removed — never used by the router (vestigial)
- Tier 1c (Damerau-Levenshtein) was also removed — only tier 0/0b/0c/1/2/4 + typo_corrected remain (7 logical tiers)
- SQL queries for business logic (auth, stats, etc.) live in `src/sql/`, not here
- Per-tier latency (measured M5 Pro, 16.0M addresses, `?no_cache=1`):
  - tier0_locality: p50 4.4ms, p95 7.6ms
  - tier1: p50 8.2ms, p95 10.5ms
  - tier0: p50 9.8ms, p95 23.1ms
  - postcode: p50 14.4ms, p95 23.4ms
  - tier4: p50 16.6ms, p95 19.3ms
  - tier2: p50 6.8ms, p95 17.8ms
  - tier0_number: p50 30.7ms, p95 68.6ms (slowest tier)
