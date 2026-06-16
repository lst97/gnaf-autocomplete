# src/lib

Shared utilities: cache, errors, logger, request, client-ip. No state, no DB access.

## OVERVIEW
Four singleton-pattern utilities used across all routes. Pure functions or class instances with explicit init.

## STRUCTURE
| File | Exports | Purpose |
|------|---------|---------|
| `cache.ts` | `LruCache`, `getSuggestCache`, `resetSuggestCache`, `buildSuggestKey`, `CachedSuggestResponse` | In-process TTL LRU for `/suggest` responses (1000 entries, 30s TTL by default) |
| `errors.ts` | `AppError`, `ValidationError`, `DatabaseError`, `ERROR_CODES`, `ErrorCode` | Custom error hierarchy + typed error code registry (19 codes) |
| `logger.ts` | `logger` (pino singleton) | Structured JSON logging |
| `request.ts` | `getOrGenerateRequestId`, `generateRequestId` | Request-scoped UUID generation (honours inbound `X-Request-Id` header) |
| `client-ip.ts` | `getRealIp` | Extract real client IP from `CF-Connecting-IP` / `X-Forwarded-For` (used by rate limit) |
| `key-hash.ts` | `hashKey`, `verifyKey` | SHA-256 hashing for API key storage |
| `touch-key.ts` | `touchKey`, `resetKeyWindow` | Rate-limit window management for API keys |
| `version-check.ts` | `startVersionCheckScheduler` | Periodic G-NAF version check (every 24h) |

## WHERE TO LOOK
- **Add utility**: pure function, no class state; follow singleton pattern only if config comes from env
- **Add new error class**: extend `AppError(message, statusCode, code)` — code is uppercase snake
- **Add log fields**: use object-first format: `logger.info({ key, val }, "message")` — never template strings

## CONVENTIONS
- **Singleton pattern** for env-derived state: lazy init in module var + `getXxx()` getter + `resetXxx()` for tests
- **LRU eviction** uses Map insertion order — O(1) get/set, no separate doubly-linked list
- **Config reads** go through the `env` import from `../env` — never read `process.env` directly
- **Logger** writes to stdout via `pino/file` transport in non-production; structured JSON in production
- **Errors** propagate as `Error` subclasses; route handler in `src/index.ts` maps `code` to status
- **Cache key format**: `buildSuggestKey(q, state, postcode, limit)` → `"main st|NSW|2000|10"` (pipe-separated)
- **LRU TTL check** happens on every `get()` AND `has()` — not just on `set()`
- **SHA-256 for API key hashing** — deliberate over bcrypt/argon2id; raw key is 32-byte CSPRNG (~2²⁵⁶ entropy), GPU brute-force infeasible, ~1ms verify time acceptable for hot path

## ANTI-PATTERNS
- **NEVER** call `resetConfig()` / `resetSuggestCache()` outside of test files
- **NEVER** use `console.log` — use `logger.info/debug/warn/error`
- **NEVER** bypass the LRU singleton by instantiating `new LruCache()` directly in route code
- **NEVER** swallow `AppError` instances — let them propagate; the global handler maps them
- **NEVER** add a logger that doesn't use the structured `{ obj }, "message"` format
- **NEVER** cache paginated results (`offset > 0`) — only first page is cached, to prevent cache pollution from arbitrary offset queries

## ERROR_CODES Registry

All error codes are defined in `errors.ts` as a `const` object:
```ts
export const ERROR_CODES = { VALIDATION_ERROR: "VALIDATION_ERROR", ... } as const;
export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
```

19 codes total: `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `RATE_LIMITED`, `INTERNAL_ERROR`, `KEY_RATE_LIMITED`, `KEY_REVOKED`, `KEY_PENDING`, `DOMAIN_MISMATCH`, `TURNSTILE_FAILED`, `DNS_ERROR`, `RECOVERY_INVALID`, `MISSING_API_KEY`, `INVALID_API_KEY`, `DOMAIN_KEY_LIMIT`, `VERIFICATION_ERROR`, `DATABASE_ERROR`, `KEY_EXPIRED`, `CANNOT_SELF_REVOKE`, `PAYLOAD_TOO_LARGE`.

- **NEVER** use raw string literals for error codes — import from `ERROR_CODES`
- All routes throw `AppError(message, statusCode, ERROR_CODES.X)` instead of returning inline `{ error, code }`
- The global `onError` handler in `src/index.ts` converts all `AppError` instances into `{ error, code, meta }` responses

## GOTCHAS
- `getSuggestCache()` reads config from `env` (not raw `process.env`)
- `getSuggestCache()` is called per-request in `src/api/suggest.ts` — singleton ensures no allocation per request
- `LruCache.get()` moves entry to MRU end by re-inserting (Map insertion order trick)
- `evictStale()` is only called inside `set()` (not `get()`) — TTL eviction is lazy on read
- `pino` writes to stdout via `pino/file` transport (not pino-pretty) in non-prod — keeps deps minimal
- `LruCache` constructor rejects `maxSize < 1` and `ttlMs < 1` (RangeError)
- `resetSuggestCache()` sets `_cacheInstance = null` — subsequent `getSuggestCache()` re-reads env
- `getSuggestCache({ maxSize, ttlMs })` opts override env for the first call; subsequent calls return the cached singleton
- `AppError` accepts `code` as a constructor arg; subclasses hardcode their own (don't pass code)
- `logger.error({ err }, "message")` is the standard pattern for caught exceptions
- **Browser-side LRU bypass**: the test UI's `apiFetch()` passes `cache: "no-store"` so the server-side LRU's `cache_status: "hit"` shows up correctly (the server's `Cache-Control: public, max-age=30` is for CDNs, not the browser)
