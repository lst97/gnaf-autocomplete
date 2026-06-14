/**
 * Request-scoped ID generation.
 *
 * Generates or reuses a UUID for each request. The value is then
 * propagated through the response body (`meta.request_id`) and
 * the `X-Request-Id` response header.
 *
 * Pattern: honour inbound `X-Request-Id` header if present (for
 * distributed tracing), otherwise generate a new UUID.
 */

/** Fallback source of truth for request_id if no inbound header. */
const _store = new WeakMap<Request, string>();

function isValidUuid(s: string): boolean {
  return /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(s);
}

/**
 * Get-or-generate a request ID for the given inbound Request.
 * If the request has an `X-Request-Id` header, that value is used.
 * Otherwise a new UUID is generated via `crypto.randomUUID()`.
 * The result is cached per Request instance via WeakMap.
 */
export function getOrGenerateRequestId(request: Request): string {
  const existing = _store.get(request);
  if (existing) return existing;

  const header = request.headers.get("X-Request-Id");
  if (header && isValidUuid(header)) {
    _store.set(request, header);
    return header;
  }

  const id = crypto.randomUUID();
  _store.set(request, id);
  return id;
}

/** Generate a fresh UUID (no inbound-header check). */
export function generateRequestId(): string {
  return crypto.randomUUID();
}
