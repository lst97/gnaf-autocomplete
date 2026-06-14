# src/db

PostgreSQL client + 7-tier query router. The performance heart of the system.

## OVERVIEW
postgres.js singleton + hand-tuned SQL for each query shape. The router picks
the cheapest viable index per query (hardcoded decision tree, not cost-based).

## STRUCTURE
| File | Purpose |
|------|---------|
| `client.ts` | postgres.js singleton (`getSql()`) |
| `queries.ts` | 8 query functions: tier0/0b/0c/1/2/4 + postcode |
| `router.ts` | `routeQuery(q, state, postcode, limit, offset)` decision tree |

## WHERE TO LOOK
- **Add new tier**: new function in `queries.ts` returning `sql\`...\``; add branch in `router.ts` decision tree
- **Modify scoring**: edit SQL `ORDER BY` clause; formula is `similarity * (1 + ln(confidence_norm + 1))`
- **Add boost**: use `strpos(lower(display), $N) > 0` for display-text substring matches

## 7-TIER ROUTER
| Tier | Trigger | Latency | Index |
|------|---------|---------|-------|
| `tier0` | state + postcode (no full address) | <1ms | btree `(state, postcode)` |
| `postcode` | purely numeric 2-4 digit | <1ms | btree `(postcode)` |
| `tier0_number` | state + street number | <1ms | btree `(state, number_first)` |
| `tier0_locality` | state + locality prefix ≥2 chars | <5ms | btree `(state, locality_lc text_pattern_ops)` |
| `tier1` | street prefix ≥3 chars | 1-3ms | btree `street_lc` |
| `tier4` | 2+ tokens, no prefix | 50-200ms | per-word trigram scoring |
| `tier2` | single-word fallback | 10-30ms | GIN trigram `search_text_expanded` |

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
- Tier 1 only runs when `prefix.length >= 3` — too short falls to tier 2/4
- State set includes `OT` (Other Territories)
- Tier 3 (GIN tsvector FTS) was removed — never used by the router (vestigial)
- SQL queries for business logic (auth, stats, etc.) live in `src/sql/`, not here
