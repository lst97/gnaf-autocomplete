# src/sql

Domain-organized SQL query modules. Extracts all raw SQL from route handlers into dedicated files.

## OVERVIEW
Each SQL module corresponds to a domain (auth, keys, stats, etc.) and exports
async functions that accept parameters and return postgres.js query results.
This prevents writing raw SQL inline in API route handlers.

## STRUCTURE
| File | Purpose |
|------|---------|
| `address.ts` | Address lookup by PID |
| `auth.ts` | API key lookup, rate-limit window updates, request counting |
| `corrector.ts` | Street/locality dictionary loading for the typo corrector |
| `health.ts` | MV populated check for readiness probe |
| `keys.ts` | All key-related operations: create, find, revoke, verify, activate |
| `stats.ts` | Aggregated usage statistics for the analytics dashboard |
| `warmup.ts` | Prewarm query definitions (targets each index tier) — `WARMUP_TASKS` array |

## WHERE TO LOOK
| Task | File |
|------|------|
| Add key-related query | `keys.ts` |
| Add auth query | `auth.ts` |
| Add stats query | `stats.ts` |
| Add address query | `address.ts` |
| Add corrector query | `corrector.ts` |
| Add warmup query | `warmup.ts` |

## CONVENTIONS
- Each function calls `getSql()` internally to get the postgres.js client
- Functions accept typed parameters and return typed results
- SQL uses postgres.js tagged templates (`sql\`...\``) for parameterized queries
- Result types are exported alongside the query functions
- Named exports only (no default exports)

## ANTI-PATTERNS
- **NEVER** import sql modules from other sql modules — keeps dependency graph flat
- **NEVER** put business logic in sql modules — they are thin wrappers

## GOTCHAS
- `fetchStreetNames()` and `fetchLocalities()` in `corrector.ts` return `{ name, n }` (not `street_name`/`locality_name`)
- `countDomainKeys()` returns a bare number (not a row object)
- The generic key row type `KeyRow` is duplicated from the DB schema
- `warmup.ts` is purely declarative (no async functions) — exports `WARMUP_TASKS` array for the warmup route handler
