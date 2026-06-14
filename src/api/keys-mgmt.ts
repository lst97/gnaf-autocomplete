import { Elysia } from "elysia";
import { AppError, ERROR_CODES } from "../lib/errors";
import { logger } from "../lib/logger";
import { findKeyByPrefix, findKeyDetailByDomain, findKeyStatus, revokeKey } from "../sql/keys";
import { checkVerifyRateLimit, validateDomain } from "./keys";

export const keyMgmtRoute = new Elysia()
  .post(
    "/api/keys/manage",
    async ({ body }) => {
      const { domain: rawDomain, api_key } = body as { domain: string; api_key: string };

      const domain = validateDomain(rawDomain);
      if (!domain) {
        throw new AppError("Invalid domain.", 400, ERROR_CODES.VALIDATION_ERROR);
      }
      if (!api_key || api_key.length < 20) {
        throw new AppError("Invalid API key.", 400, ERROR_CODES.VALIDATION_ERROR);
      }

      const prefix = api_key.startsWith("gnaf_pk_") ? api_key.slice(8, 16) : api_key.slice(0, 8);
      const rows = await findKeyByPrefix(prefix);

      if (rows.length === 0) {
        throw new AppError("API key not found.", 403, ERROR_CODES.FORBIDDEN);
      }
      // biome-ignore lint/style/noNonNullAssertion: length check above guarantees existence
      const row = rows[0]!;

      const valid = await Bun.password.verify(api_key, row.key_hash);
      if (!valid) {
        throw new AppError("API key does not match.", 403, ERROR_CODES.FORBIDDEN);
      }
      if (row.status !== "active") {
        throw new AppError(`Key is ${row.status}, not active.`, 403, ERROR_CODES.FORBIDDEN);
      }
      if (row.domain !== domain) {
        throw new AppError(
          "API key is not registered for this domain.",
          403,
          ERROR_CODES.FORBIDDEN,
        );
      }

      const allRows = await findKeyDetailByDomain(domain);

      return {
        status: "verified",
        domain,
        keys: allRows.map((r) => ({
          prefix: r.prefix,
          status: r.status,
          created_at: r.created_at,
          last_used_at: r.last_used_at ?? null,
          last_verified_at: r.last_verified_at ?? null,
          request_count: r.request_count,
        })),
      };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Manage keys using existing API key",
        description:
          "Validates an active API key for a domain, then returns all keys for that domain.",
      },
    },
  )
  .post(
    "/api/keys/:prefix/revoke",
    async ({ params, request }) => {
      const { prefix } = params;

      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        request.headers.get("cf-connecting-ip") ??
        "unknown";
      if (!checkVerifyRateLimit(ip)) {
        throw new AppError(
          "Too many attempts. Try again in a minute.",
          429,
          ERROR_CODES.RATE_LIMITED,
        );
      }

      const rows = await findKeyByPrefix(prefix);
      if (rows.length === 0) {
        throw new AppError("Key not found.", 404, ERROR_CODES.NOT_FOUND);
      }
      // biome-ignore lint/style/noNonNullAssertion: length check above guarantees existence
      const row = rows[0]!;
      if (row.status === "revoked") {
        return { status: "revoked", message: "Key was already revoked." };
      }

      await revokeKey(prefix);
      logger.info({ domain: row.domain, key_prefix: prefix }, "key_revoked");
      return { status: "revoked", domain: row.domain, message: "Key revoked successfully." };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Revoke an API key by prefix",
        description: "Revokes a key so it can no longer be used.",
      },
    },
  )
  .get(
    "/api/keys/:prefix/status",
    async ({ params }) => {
      const { prefix } = params;
      const rows = await findKeyStatus(prefix);

      if (rows.length === 0) {
        throw new AppError("Key not found.", 404, ERROR_CODES.NOT_FOUND);
      }

      // biome-ignore lint/style/noNonNullAssertion: length check above guarantees existence
      const row = rows[0]!;
      return {
        status: row.status,
        domain: row.domain,
        created_at: row.created_at,
        last_verified_at: row.last_verified_at ?? null,
      };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Check API key status",
        description: "Returns the current status of an API key by its prefix.",
      },
    },
  );
