import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Hash a raw API key with SHA-256 and return the hex digest (64 lowercase hex chars).
 *
 * SHA-256 is chosen over bcrypt/argon2id because:
 *  - The raw key is a 32-byte CSPRNG token (2^256 entropy) — offline brute
 *    force is infeasible even at GPU speed (~10⁹ SHA-256/s).
 *  - The auth middleware runs on every /suggest and /address/:id request;
 *    a slow KDF would add 50-100ms per request, pushing the p95 past 50ms.
 */
export function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Constant-time comparison of a raw API key against a stored SHA-256 hex hash.
 *
 * Uses Node.js crypto.timingSafeEqual to prevent timing side-channel attacks.
 * Both values are hex-decoded to Buffer before comparison.
 */
export function verifyKey(rawKey: string, storedHash: string): boolean {
  const computed = Buffer.from(hashKey(rawKey), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}
