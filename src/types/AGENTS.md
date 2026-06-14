# src/types

Common TypeScript types used across multiple modules.

## STRUCTURE
| Export | Source | Used by |
|--------|--------|---------|
| `AuthContext` | `index.ts` | Auth derive middleware + all protected route handlers |
| `ResponseMeta` | `index.ts` | `{ took_ms, request_id, timestamp }` envelope on every response |
| `ErrorResponseBody` | `index.ts` | Standard error shape `{ error, code, meta }` through global `onError` handler |
