import { Elysia, t } from "elysia";
import { env } from "../env";
import { getRealIp } from "../lib/client-ip";
import { AppError, ERROR_CODES } from "../lib/errors";
import { hashKey } from "../lib/key-hash";
import { logger } from "../lib/logger";
import { checkKeygenRateLimit, validateDomain } from "./keys";

export const keyGenRoute = new Elysia()
  .get(
    "/api/config",
    () => {
      return { turnstileSiteKey: env.TURNSTILE_SITE_KEY, gnafVersion: env.GNAF_VERSION };
    },
    {
      detail: {
        tags: ["Auth"],
        summary: "Public client-side configuration",
        description:
          "Returns non-sensitive configuration values needed by the key management page (e.g., Turnstile site key).",
      },
    },
  )
  .post(
    "/api/keys",
    async ({ body, request, set }) => {
      const start = performance.now();

      // Rate limit by IP
      const ip = getRealIp(request);
      const { allowed } = checkKeygenRateLimit(ip);
      if (!allowed) {
        throw new AppError(
          "Too many requests. Please try again later.",
          429,
          ERROR_CODES.RATE_LIMITED,
        );
      }

      const { domain: rawDomain, turnstile_token } = body;

      // 1. Validate domain
      const domain = validateDomain(rawDomain);
      if (!domain) {
        throw new AppError(
          "Invalid domain. Please enter a valid domain name (e.g., myapp.com).",
          400,
          ERROR_CODES.VALIDATION_ERROR,
        );
      }

      // 1b. Check domain key limit
      const { countDomainKeys, insertApiKey } = await import("../sql/keys");
      const existingCount = await countDomainKeys(domain);
      const remaining = env.MAX_KEYS_PER_DOMAIN - existingCount;
      if (remaining <= 0) {
        throw new AppError(
          `Domain "${domain}" already has ${existingCount} key(s). Maximum is ${env.MAX_KEYS_PER_DOMAIN}. Revoke an existing key first.`,
          429,
          ERROR_CODES.DOMAIN_KEY_LIMIT,
        );
      }

      // 2. Validate Turnstile token
      if (env.NODE_ENV === "production" && env.TURNSTILE_SECRET_KEY) {
        const formData = new URLSearchParams();
        formData.append("secret", env.TURNSTILE_SECRET_KEY);
        formData.append("response", turnstile_token ?? "");

        const turnstileRes = await fetch(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          { method: "POST", body: formData },
        );
        const turnstileResult = (await turnstileRes.json()) as { success: boolean };

        if (!turnstileResult.success) {
          throw new AppError(
            "Turnstile verification failed. Please complete the challenge again.",
            400,
            ERROR_CODES.TURNSTILE_FAILED,
          );
        }
      }

      const now = new Date();
      const keys: Array<{
        key: string;
        prefix: string;
        verification_token: string;
      }> = [];

      for (let i = 0; i < remaining; i++) {
        const rawBytes = crypto.getRandomValues(new Uint8Array(32));
        const base64 = btoa(String.fromCodePoint(...rawBytes))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
        const apiKey = `gnaf_pk_${base64}`;
        const prefix = apiKey.slice(8, 16);

        const verifyBytes = crypto.getRandomValues(new Uint8Array(16));
        const verificationToken = Array.from(verifyBytes)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        const keyHash = hashKey(apiKey);
        await insertApiKey(prefix, keyHash, domain, verificationToken, now);

        keys.push({ key: apiKey, prefix, verification_token: verificationToken });
      }

      const tookMs = Math.round(performance.now() - start);
      logger.info({ domain, count: keys.length, took_ms: tookMs }, "keys_generated");

      set.status = 201;
      return {
        keys,
        domain,
        generated_count: keys.length,
        max_allowed: env.MAX_KEYS_PER_DOMAIN,
        total_for_domain: existingCount + keys.length,
      };
    },
    {
      body: t.Object({
        domain: t.String({
          minLength: 3,
          maxLength: 255,
          description: "The domain to bind this API key to (e.g., myapp.com).",
          example: "myapp.com",
        }),
        turnstile_token: t.Optional(t.String()),
      }),
      detail: {
        tags: ["Auth"],
        summary: "Generate a new domain-bound API key",
        description:
          "Creates a new API key bound to the specified domain. The caller must first complete a Cloudflare Turnstile challenge. The raw key is returned once and will not be stored in plaintext.",
      },
    },
  );
