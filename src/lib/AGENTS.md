# src/lib

Shared utilities: cache, errors, logger, request. No state, no DB access.

## OVERVIEW
Three singleton-pattern utilities used across all routes. Pure functions or class instances with explicit init.

## STRUCTURE
| File | Exports | Purpose |
|------|---------|---------|
| `cache.ts` | `LruCache`, `getSuggestCache`, `resetSuggestCache`, `buildSuggestKey`, `CachedSuggestResponse` | In-process TTL LRU for `/suggest` responses |
| `errors.ts` | `AppError`, `ValidationError`, `DatabaseError`, `ERROR_CODES`, `ErrorCode` | Custom error hierarchy + typed error code registry |
| `logger.ts` | `logger` (pino singleton) | Structured JSON logging |
| `request.ts` | `getOrGenerateRequestId`, `generateRequestId` | Request-scoped UUID generation (honours inbound `X-Request-Id` header) |

## WHERE TO LOOK
- **Add utility**: pure function, no class state; follow singleton pattern only if config comes from env
- **Add new error class**: extend `AppError(message, statusCode, code)` — code is uppercase snake
- **Add log fields**: use object-first format: `logger.info({ key, val }, "message")` — never template strings

## CONVENTIONS
- **Singleton pattern** for env-derived state: lazy init in module var + `getXxx()` getter + `resetXxx()` for tests
- **LRU eviction** uses Map insertion order — O(1) get/set, no separate doubly-linked list
- **Config reads** go through `getConfig()` — never read `process.env` directly (see `cache.ts` for the pattern)
- **Logger** writes to stdout via `pino/file` transport in non-production; structured JSON in production
- **Errors** propagate as `Error` subclasses; route handler in `src/index.ts` maps `code` to status
- **Cache key format**: `buildSuggestKey(q, state, postcode, limit)` → `"main st|NSW|2000|10"` (pipe-separated)
- **LRU TTL check** happens on every `get()` AND `has()` — not just on `set()`

## ANTI-PATTERNS
- **NEVER** call `resetConfig()` / `resetSuggestCache()` outside of test files
- **NEVER** use `console.log` — use `logger.info/debug/warn/error`
- **NEVER** bypass the LRU singleton by instantiating `new LruCache()` directly in route code
- **NEVER** swallow `AppError` instances — let them propagate; the global handler maps them
- **NEVER** add a logger that doesn't use the structured `{ obj }, "message"` format

## ERROR_CODES Registry

All error codes are defined in `errors.ts` as a `const` object:
```ts
export const ERROR_CODES = { VALIDATION_ERROR: "VALIDATION_ERROR", ... } as const;
export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
```

- **NEVER** use raw string literals for error codes — import from `ERROR_CODES`
- All routes throw `AppError(message, statusCode, ERROR_CODES.X)` instead of returning inline `{ error, code }`
- The global `onError` handler in `src/index.ts` converts all `AppError` instances into `{ error, code, meta }` responses

## GOTCHAS
- `getSuggestCache()` reads config from `getConfig()` (not raw `process.env`)
- `getSuggestCache()` is called per-request in `src/api/suggest.ts` — singleton ensures no allocation per request
- `LruCache.get()` moves entry to MRU end by re-inserting (Map insertion order trick)
- `evictStale()` is only called inside `set()` (not `get()`) — TTL eviction is lazy on read
- `pino` writes to stdout via `pino/file` transport (not pino-pretty) in non-prod — keeps deps minimal
- `LruCache` constructor rejects `maxSize < 1` and `ttlMs < 1` (RangeError)
- `resetSuggestCache()` sets `_cacheInstance = null` — subsequent `getSuggestCache()` re-reads env
- `getSuggestCache({ maxSize, ttlMs })` opts override env for the first call; subsequent calls return the cached singleton
- `AppError` accepts `code` as a constructor arg; subclasses hardcode their own (don't pass code)
- `logger.error({ err }, "message")` is the standard pattern for caught exceptions
