import { Elysia } from "elysia";
import { LruCache } from "../lib/cache";
import { AppError, ERROR_CODES } from "../lib/errors";
import { logger } from "../lib/logger";
import { countActiveKeysForDomain, findKeyByPrefix, revokeKey } from "../sql/keys";
import type { AuthContext } from "../types";
import { authPlugin } from "./auth";

// Per-auth-key burst tracker for bulk-revoke WARN log
const revokeBurstTracker = new LruCache<string, { count: number; lastTs: number }>(100_000, 60000);

export const keyRevokeRoute = new Elysia().use(authPlugin).post(
  "/api/keys/:prefix/revoke",
  async ({ params, ...context }) => {
    const auth = (context as unknown as { auth: AuthContext }).auth;
    const { prefix: targetPrefix } = params;
    const authPrefix = auth.keyPrefix;
    const authDomain = auth.domain;

    const targetRows = await findKeyByPrefix(targetPrefix);
    if (targetRows.length === 0) {
      throw new AppError("Key not found.", 404, ERROR_CODES.NOT_FOUND);
    }
    // biome-ignore lint/style/noNonNullAssertion: length check above guarantees existence
    const targetRow = targetRows[0]!;

    if (targetRow.domain !== authDomain) {
      throw new AppError(
        "Domain mismatch. The X-API-Key is registered for a different domain.",
        403,
        ERROR_CODES.DOMAIN_MISMATCH,
      );
    }

    if (targetRow.status === "revoked") {
      return { status: "revoked", message: "Key was already revoked." };
    }

    // Last-key guard on self-revoke
    if (targetPrefix === authPrefix) {
      const activeCount = await countActiveKeysForDomain(authDomain);
      if (activeCount > 1) {
        throw new AppError(
          "Cannot revoke your own key while other active keys exist. " +
            "Revoke them first, or use DNS recovery to revoke all keys for your domain.",
          409,
          ERROR_CODES.CANNOT_SELF_REVOKE,
        );
      }
      // count === 1: this is the explicit "delete my last key" action — allow
    }

    await revokeKey(targetPrefix);
    logger.info({ auth_key_prefix: authPrefix, target_prefix: targetPrefix }, "key_revoked");

    // Bulk-revoke WARN log: detect ≥ 2 revokes from same auth key within 60s
    const now = Date.now();
    const burst = revokeBurstTracker.get(authPrefix);
    if (burst) {
      if (now - burst.lastTs < 60000) {
        burst.count++;
        burst.lastTs = now;
        if (burst.count >= 2) {
          logger.warn(
            {
              event: "bulk_revoke",
              auth_key_prefix: authPrefix,
              domain: authDomain,
              revoke_count: burst.count,
              window_sec: 60,
            },
            "Multiple revokes from same auth key in short window",
          );
        }
      } else {
        burst.count = 1;
        burst.lastTs = now;
      }
    } else {
      revokeBurstTracker.set(authPrefix, { count: 1, lastTs: now });
    }

    return { status: "revoked", domain: authDomain, message: "Key revoked successfully." };
  },
  {
    detail: {
      tags: ["Auth"],
      summary: "Revoke an API key by prefix",
      description:
        "Revokes an API key by its 8-character prefix. Requires X-API-Key header " +
        "with an active key in the same domain. Self-revocation is only allowed when " +
        "the auth key is the last active key in the domain.",
    },
  },
);
