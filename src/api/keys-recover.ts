import { Elysia } from "elysia";
import { getConfig } from "../config";
import { AppError, ERROR_CODES } from "../lib/errors";
import { logger } from "../lib/logger";
import { activateAllPendingKeysForDomain, findKeyForVerification, findRecoveryKeyDetailByDomain } from "../sql/keys";
import { checkVerifyRateLimit, generateToken, recoverySessions, validateDomain } from "./keys";

export const keyRecoverRoute = new Elysia()
  .post(
    "/api/keys/recover/start",
    async ({ body }) => {
      const { domain: rawDomain, turnstile_token: tsToken } = body as {
        domain: string;
        turnstile_token?: string;
      };

      const tsConfig = getConfig();
      if (tsConfig.TURNSTILE_SECRET_KEY) {
        const fd = new URLSearchParams();
        fd.append("secret", tsConfig.TURNSTILE_SECRET_KEY);
        fd.append("response", tsToken ?? "");
        const tRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          body: fd,
        });
        const tData = (await tRes.json()) as { success: boolean };
        if (!tData.success) {
          throw new AppError("Turnstile verification failed.", 400, ERROR_CODES.TURNSTILE_FAILED);
        }
      }
      const domain = validateDomain(rawDomain);
      if (!domain) {
        throw new AppError("Invalid domain.", 400, ERROR_CODES.VALIDATION_ERROR);
      }

      const token = generateToken();
      recoverySessions.set(token, {
        domain,
        verificationToken: token,
        expiresAt: Date.now() + 1_800_000,
      });

      if (recoverySessions.size > 100) {
        const now = Date.now();
        for (const [k, v] of recoverySessions) {
          if (v.expiresAt < now) recoverySessions.delete(k);
        }
      }

      return { domain, verification_token: token, expires_in_sec: 1800 };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Start key recovery — get DNS verification token",
        description:
          "Generates a token that must be added as a DNS TXT record to prove domain ownership.",
      },
    },
  )
  .post(
    "/api/keys/recover/verify",
    async ({ body, request }) => {
      const {
        domain: rawDomain,
        verification_token,
        turnstile_token: tsToken,
      } = body as { domain: string; verification_token: string; turnstile_token?: string };

      const tsConfig = getConfig();
      if (tsConfig.TURNSTILE_SECRET_KEY) {
        const fd = new URLSearchParams();
        fd.append("secret", tsConfig.TURNSTILE_SECRET_KEY);
        fd.append("response", tsToken ?? "");
        const tRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          body: fd,
        });
        const tData = (await tRes.json()) as { success: boolean };
        if (!tData.success) {
          throw new AppError("Turnstile verification failed.", 400, ERROR_CODES.TURNSTILE_FAILED);
        }
      }

      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        request.headers.get("cf-connecting-ip") ??
        "unknown";
      if (!checkVerifyRateLimit(ip)) {
        throw new AppError("Too many attempts.", 429, ERROR_CODES.RATE_LIMITED);
      }

      const domain = validateDomain(rawDomain);
      if (!domain) {
        throw new AppError("Invalid domain.", 400, ERROR_CODES.VALIDATION_ERROR);
      }

      const session = recoverySessions.get(verification_token);
      if (!session || session.domain !== domain || session.expiresAt < Date.now()) {
        throw new AppError(
          "Invalid or expired verification token. Start recovery again.",
          400,
          ERROR_CODES.RECOVERY_INVALID,
        );
      }

      // Check DNS TXT records
      const expectedValue = `gnaf-mgmt=${verification_token}`;
      let found = false;
      try {
        const { resolveTxt } = await import("node:dns");
        const records = await new Promise<string[][]>((resolve, reject) => {
          resolveTxt(domain, (err, records) => {
            if (err) reject(err);
            else resolve(records);
          });
        });
        for (const rs of records) {
          if (rs.join("").trim() === expectedValue) {
            found = true;
            break;
          }
        }
      } catch {
        throw new AppError("Could not query DNS records.", 502, ERROR_CODES.DNS_ERROR);
      }

      if (!found) {
        return {
          status: "pending",
          message: "TXT record not found yet. Add gnaf-mgmt=<token> to your DNS.",
        };
      }

      const rows = await findRecoveryKeyDetailByDomain(domain);

      for (const [k, v] of recoverySessions) {
        if (v.domain === domain && k !== verification_token) recoverySessions.delete(k);
      }
      recoverySessions.delete(verification_token);

      return {
        status: "verified",
        domain,
        keys: rows.map((r) => ({
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
        summary: "Verify DNS and list keys for recovery",
        description:
          "Checks DNS for the verification token. If found, returns all keys for the domain.",
      },
    },
  )
  .post(
    "/api/keys/:prefix/verify",
    async ({ params, request }) => {
      const { prefix } = params;

      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        request.headers.get("cf-connecting-ip") ??
        "unknown";
      if (!checkVerifyRateLimit(ip)) {
        throw new AppError(
          "Too many verification attempts. Try again in a minute.",
          429,
          ERROR_CODES.RATE_LIMITED,
        );
      }

      const rows = await findKeyForVerification(prefix);

      if (rows.length === 0) {
        throw new AppError("Key not found.", 404, ERROR_CODES.NOT_FOUND);
      }

      // biome-ignore lint/style/noNonNullAssertion: length check above guarantees existence
      const row = rows[0]!;

      if (row.status === "active") {
        return {
          status: "active",
          domain: row.domain,
          message: "Key is already verified and active.",
        };
      }
      if (row.status === "revoked") {
        throw new AppError("Key has been revoked.", 403, ERROR_CODES.KEY_REVOKED);
      }

      if (!row.verification_token) {
        throw new AppError(
          "No verification token found for this key.",
          400,
          ERROR_CODES.VERIFICATION_ERROR,
        );
      }

      const expectedValue = `gnaf-verify=${row.verification_token}`;
      let found = false;

      try {
        const { resolveTxt } = await import("node:dns");
        const records = await new Promise<string[][]>((resolve, reject) => {
          resolveTxt(row.domain, (err, records) => {
            if (err) reject(err);
            else resolve(records);
          });
        });

        for (const recordSet of records) {
          const txt = recordSet.join("").trim();
          if (txt === expectedValue) {
            found = true;
            break;
          }
        }
      } catch (dnsErr) {
        logger.warn(
          { domain: row.domain, err: dnsErr },
          "DNS lookup failed for domain verification",
        );
        throw new AppError(
          "Could not query DNS records for this domain. Ensure the domain has valid DNS.",
          502,
          ERROR_CODES.DNS_ERROR,
        );
      }

      if (found) {
        const count = await activateAllPendingKeysForDomain(row.domain);
        logger.info(
          { domain: row.domain, activated_count: count },
          "domain_verified_keys_activated",
        );
        return {
          status: "verified",
          domain: row.domain,
          message: `Domain ownership verified. ${count} key(s) activated.`,
        };
      }

      return {
        status: "pending",
        domain: row.domain,
        message: `TXT record not found. Add this TXT record: ${expectedValue}`,
      };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Verify domain ownership via DNS TXT record",
        description:
          "Checks the domain's DNS TXT records for the verification token. If found, the key status changes from 'pending' to 'active'. Rate-limited to 5 checks per minute per IP.",
      },
    },
  );
