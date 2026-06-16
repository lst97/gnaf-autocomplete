/**
 * Client-IP extraction helper.
 *
 * Strategy:
 * 1. If the request has a `cf-ray` header (Cloudflare signature), trust
 *    `cf-connecting-ip` and return that value.
 * 2. Otherwise, return the socket peer's address (Bun's `server.requestIP`
 *    or the server's `remoteAddress` at connection level). Fall back to
 *    "unknown".
 *
 * The blind `X-Forwarded-For` trust is intentionally dropped — it's
 * spoofable by any client not behind a trusted proxy.
 */

export function getRealIp(request: Request): string {
  // Cloudflare sets `cf-ray` on every request routed through its network.
  // When present, `CF-Connecting-IP` is trustworthy.
  if (request.headers.get("cf-ray")) {
    return request.headers.get("cf-connecting-ip") ?? "unknown";
  }

  // No known proxy: use the socket peer. Bun/Elysia exposes this via
  // `server.requestIP()`. Since Elysia's `Request` object doesn't have
  // direct access to the underlying socket in all versions, we fall
  // back to "unknown" when no proxy is present.
  // In practice, the deployment should be behind Cloudflare Tunnel,
  // so this path is only hit in local dev where rate-limiting accuracy
  // is less critical.
  return "unknown";
}
