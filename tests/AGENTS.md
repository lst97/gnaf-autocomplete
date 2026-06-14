# tests

bun:test — unit (no DB) + integration (live API).

## OVERVIEW
Unit tests import source functions directly and assert on return values.
Integration tests hit the live API at `API_URL` and skip if `/healthz` is down.
All tests use `bun:test` (not Jest, not Mocha).

## STRUCTURE
| Path | Purpose |
|------|---------|
| `unit/*.test.ts` | Isolated function tests — no DB, no network (9 files) |
| `integration/api.test.ts` | Live API tests — skips if `/healthz` is down |
| `fixtures/*.psv` | Pipe-delimited test data (5 files: state, locality, street_locality, addresses, geocode) |

## WHERE TO LOOK
- **Add unit test**: drop `.test.ts` next to source logic → `bun:test` discovers it
- **Test tier routing**: import `routeQuery` from `src/db/router.ts` directly; assert on `r.tier` string
- **Test scoring**: import `computeScore` from `src/search/scorer.ts`; use `toBeCloseTo()` for float
- **Test sanitizer**: import `sanitizeQuery` (or test the regex pattern directly, as `tests/unit/suggest.test.ts` does)
- **Add integration test**: extend `tests/integration/api.test.ts`; call `apiOnline()` first; skip if down

## CONVENTIONS
- **Imports**: `import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"`
- **No mocking of DB** — unit tests import actual source functions
- **Async tests**: `async` callback on `test()`; no `done()` pattern
- **API online check**: `apiOnline()` polls `/healthz` before integration tests; tests skip if API down
- **Timeout**: 3000ms default; uses `AbortSignal.timeout()` for fetch
- **Cache key format**: `buildSuggestKey(q, state, postcode, limit)` → `"main st|NSW|2000|10"` (pipe-separated)
- **Fixture format**: PSV (pipe-delimited), header row required, `tests/fixtures/<table>.psv`

## ANTI-PATTERNS
- **NEVER** mock the DB — test the real query router; if tests need DB data, document it
- **NEVER** use `test.each` / `describe.each` — Bun's runner is fine without it; keep individual `test()` blocks
- **NEVER** add tests that depend on external network (other than the local API)
- **NEVER** commit test fixtures with PII — only synthetic test data

## GOTCHAS
- Integration tests connect to `API_URL` env var (default `http://localhost:8000`)
- Cache tests must call `resetSuggestCache()` in `beforeEach` to ensure singleton isolation
- Config tests must call `resetConfig()` and restore `process.env` in `afterEach`
- Router tests don't need a DB — `routeQuery` returns the tier, not the rows
- Tokenizer tests cover G-NAF-specific patterns: `1/6 fortuna`, `unit 1 6 fortuna`, `apt 5 george`
- `tests/unit/address.test.ts` tests query router by `tier` string, not by actual query results (no DB)
- Formatter tests verify `buildDisplay` edge cases: level codes (B/G/FL/L), number ranges, suffixes
- Errors tests assert `instanceof Error` for `AppError` subclasses (see `tests/unit/errors.test.ts:23`)
- Integration test for `q < 2 chars` expects HTTP 400 (Elysia validation)
- Integration tests check `Cache-Control: public` AND `X-Request-Id` header presence
