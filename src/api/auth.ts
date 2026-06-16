import { Elysia } from "elysia";
import { env } from "../env";
import { AppError, ERROR_CODES } from "../lib/errors";
import { verifyKey } from "../lib/key-hash";
import { logger } from "../lib/logger";
import { resetKeyWindow, touchKey } from "../lib/touch-key";
import { lookupApiKeyByPrefix } from "../sql/auth";
import type { AuthContext } from "../types";

function hostnameMatches(needle: string, registeredDomain: string): boolean {
  return needle === registeredDomain || needle.endsWith(`.${registeredDomain}`);
}

function extractHostname(headerValue: string | null): string | null {
  if (!headerValue) return null;
  try {
    return new URL(headerValue).hostname;
  } catch {
    return null;
  }
}

export const authDerive = async ({
  request,
  headers,
  set,
}: {
  request: Request;
  headers: Record<string, string | undefined>;
  set: { headers?: Record<string, string | number>; status?: number | string };
}): Promise<{ auth: AuthContext } | Record<string, unknown>> => {
  const start = performance.now();
  const apiKey = String(headers["x-api-key"] ?? "");

  if (!apiKey) {
    throw new AppError(
      "Missing API key. Provide it via the X-API-Key header.",
      401,
      ERROR_CODES.MISSING_API_KEY,
    );
  }

  const prefix = apiKey.startsWith("gnaf_pk_") ? apiKey.slice(8, 16) : apiKey.slice(0, 8);
  if (prefix.length < 4) {
    throw new AppError("Invalid API key.", 401, ERROR_CODES.INVALID_API_KEY);
  }

  const rows = await lookupApiKeyByPrefix(prefix);

  if (rows.length === 0) {
    throw new AppError("Invalid API key.", 401, ERROR_CODES.INVALID_API_KEY);
  }

  // biome-ignore lint/style/noNonNullAssertion: length check above guarantees existence
  const row = rows[0]!;

  if (!verifyKey(apiKey, row.key_hash)) {
    throw new AppError("Invalid API key.", 401, ERROR_CODES.INVALID_API_KEY);
  }

  if (row.status === "revoked") {
    throw new AppError("API key has been revoked.", 403, ERROR_CODES.KEY_REVOKED);
  }
  if (row.status === "pending") {
    throw new AppError(
      "API key is pending domain verification. Add the DNS TXT record and verify at /keys.",
      403,
      ERROR_CODES.KEY_PENDING,
    );
  }

  // Expiry check (runs before rate-limit update — no row write for expired keys)
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    throw new AppError(
      "API key has expired. Generate a new key at /keys.",
      401,
      ERROR_CODES.KEY_EXPIRED,
    );
  }

  const referer = request.headers.get("referer");
  const origin = request.headers.get("origin");
  const refererHost = extractHostname(referer);
  const originHost = extractHostname(origin);

  const publicUrlHost = env.PUBLIC_URL ? extractHostname(env.PUBLIC_URL) : null;

  // Allow requests from the API's own public URL to use any API key (for testing from the UI)
  const isSameOrigin =
    (originHost != null && publicUrlHost != null && hostnameMatches(originHost, publicUrlHost)) ||
    (refererHost != null && publicUrlHost != null && hostnameMatches(refererHost, publicUrlHost));

  if (!isSameOrigin) {
    if (originHost && !hostnameMatches(originHost, row.domain)) {
      throw new AppError(
        "Domain mismatch. The Origin header does not match the key's registered domain.",
        403,
        ERROR_CODES.DOMAIN_MISMATCH,
      );
    }
    if (refererHost && !hostnameMatches(refererHost, row.domain)) {
      throw new AppError(
        "Domain mismatch. The Referer header does not match the key's registered domain.",
        403,
        ERROR_CODES.DOMAIN_MISMATCH,
      );
    }
  }

  // Rate-limit logic with throttled `expires_at` auto-extension
  const now = new Date();
  let rateRemaining = env.API_KEY_RATE_LIMIT;

  if (row.rl_window_start) {
    const windowEnd = new Date(row.rl_window_start.getTime() + env.API_KEY_RATE_WINDOW_MS);
    if (now < windowEnd) {
      if (row.rl_window_count >= env.API_KEY_RATE_LIMIT) {
        set.headers = {
          "X-RateLimit-Limit": String(env.API_KEY_RATE_LIMIT),
          "X-RateLimit-Remaining": "0",
        };
        throw new AppError("Key rate limit exceeded.", 429, ERROR_CODES.KEY_RATE_LIMITED);
      }
      rateRemaining = env.API_KEY_RATE_LIMIT - row.rl_window_count - 1;
      await touchKey(prefix, now);
    } else {
      rateRemaining = env.API_KEY_RATE_LIMIT - 1;
      await resetKeyWindow(prefix, now);
    }
  } else {
    rateRemaining = env.API_KEY_RATE_LIMIT - 1;
    await resetKeyWindow(prefix, now);
  }

  // Clamp to non-negative (race conditions or corrupted counters)
  rateRemaining = Math.max(0, rateRemaining);

  const tookMs = Math.round(performance.now() - start);
  const headersForLog = {
    referer_host: refererHost,
    origin_host: originHost,
    origin_matched: originHost ? hostnameMatches(originHost, row.domain) : null,
    referer_matched: refererHost ? hostnameMatches(refererHost, row.domain) : null,
  };

  logger.info(
    {
      key_prefix: prefix,
      domain: row.domain,
      ...headersForLog,
      rate_remaining: rateRemaining,
      took_ms: tookMs,
    },
    "auth_check",
  );

  set.headers = {
    "X-RateLimit-Limit": String(env.API_KEY_RATE_LIMIT),
    "X-RateLimit-Remaining": String(rateRemaining),
    "X-Key-Status": "active",
  } as Record<string, string>;

  return { auth: { keyPrefix: prefix, domain: row.domain } } as { auth: AuthContext };
};

export const authPlugin = new Elysia({ name: "auth" }).derive(authDerive);
