import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import { addressRoute } from "./api/address";
import { authDerive } from "./api/auth";
import { checkUpdateRoute } from "./api/check-update";
import { healthRoute } from "./api/health";
import { keysRoute } from "./api/keys";
import { keyRevokeRoute } from "./api/keys-revoke";
import { openapiConfig } from "./api/openapi";
import { staticRoute } from "./api/static";
import { statsRoute } from "./api/stats";
import { suggestRoute } from "./api/suggest";
import { warmupRoute } from "./api/warmup";
import { closeDb, getSql } from "./db/client";
import { env } from "./env";
import { AppError, ERROR_CODES } from "./lib/errors";
import { logger } from "./lib/logger";
import { getOrGenerateRequestId } from "./lib/request";
import { startVersionCheckScheduler } from "./lib/version-check";
import { ensureCorrector } from "./search/corrector";
import type { ResponseMeta } from "./types";

const corsOrigins =
  env.CORS_ORIGINS === "*"
    ? { origin: "*" }
    : env.CORS_ORIGINS
      ? { origin: env.CORS_ORIGINS.split(",").map((s) => s.trim()) }
      : {};

function buildResponseMeta(request: Request): ResponseMeta {
  return {
    took_ms: 0, // filled after handler runs
    request_id: getOrGenerateRequestId(request),
    timestamp: new Date().toISOString(),
  };
}

const app = new Elysia({ serve: { maxRequestBodySize: 64 * 1024 } })
  // === Common derive: request_id for all requests ===
  .derive(({ request }) => ({
    requestMeta: buildResponseMeta(request),
    _startTime: performance.now(),
  }))
  // === Common after-handle: inject meta into success responses ===
  .onAfterHandle(({ response, set, requestMeta, _startTime }) => {
    const tookMs = Math.round(performance.now() - _startTime);
    const meta: ResponseMeta = {
      ...requestMeta,
      took_ms: tookMs,
      timestamp: new Date().toISOString(),
    };

    // Inject meta into plain-object responses (most routes)
    if (response && typeof response === "object" && !(response instanceof Response)) {
      (response as Record<string, unknown>).meta = meta;
    }

    // Set response header
    set.headers ??= {};
    set.headers["X-Request-Id"] = meta.request_id;
  })
  // === Security response headers ===
  .onAfterHandle(({ set }) => {
    set.headers ??= {};
    set.headers["Strict-Transport-Security"] ??= "max-age=63072000; includeSubDomains";
    set.headers["X-Content-Type-Options"] ??= "nosniff";
    set.headers["Referrer-Policy"] ??= "strict-origin-when-cross-origin";
    set.headers["X-Frame-Options"] ??= "DENY";
  })
  // === Global error handler (must run before middleware) ===
  .onError(({ code, error, set, requestMeta, _startTime }) => {
    const tookMs = _startTime != null ? Math.round(performance.now() - _startTime) : 0;
    const meta: ResponseMeta = {
      request_id: requestMeta?.request_id ?? "unknown",
      took_ms: tookMs,
      timestamp: new Date().toISOString(),
    };

    if (error instanceof AppError) {
      set.status = error.statusCode;
      set.headers ??= {};
      set.headers["X-Request-Id"] = meta.request_id;
      return { error: error.message as string, code: error.code, meta };
    }
    if (code === "NOT_FOUND") {
      return new Response(
        `<!DOCTYPE html><html lang="en-AU"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>404 — G-NAF Address Autocomplete</title><link rel="stylesheet" href="/style.css"></head><body><div class="page-header"><h1>🏠 G-NAF Address Autocomplete <small>16M Australian addresses</small></h1><div class="subtitle"><strong class="text-green">Address lookups should be free. Simple as that.</strong> &middot; <a href="/openapi" target="_blank">OpenAPI specs ↗</a> &middot; <a href="/analytics">📊 Analytics</a></div></div><div style="display:flex;align-items:center;justify-content:center;min-height:40vh;text-align:center"><div><h1 style="font-size:4rem;margin-bottom:0">404</h1><p style="font-size:1.2rem;color:var(--base00);margin-bottom:2rem">Page not found</p><p><a href="/" class="btn" style="text-decoration:none">← Back home</a></p></div></div><div class="page-footer"><svg class="gh-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg><span>G-NAF Address Autocomplete</span><span>&middot;</span><span>Service by <a href="https://www.lst97.dev" target="_blank" rel="noopener">lst97.dev</a></span><span>&middot;</span><a href="https://github.com/lst97/gnaf-autocomplete" target="_blank" rel="noopener">Source ↗</a><span>&middot;</span><span>G-NAF &copy; Geoscape Australia CC BY 4.0</span></div></body></html>`,
        {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8", "X-Request-Id": meta.request_id },
        },
      );
    }
    if (code === "VALIDATION") {
      return new Response(
        JSON.stringify({ error: "Validation failed", code: ERROR_CODES.VALIDATION_ERROR, meta }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", "X-Request-Id": meta.request_id },
        },
      );
    }
    logger.error({ code, error }, "Request error");
    return new Response(
      JSON.stringify({ error: "Internal server error", code: ERROR_CODES.INTERNAL_ERROR, meta }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", "X-Request-Id": meta.request_id },
      },
    );
  })
  // === Infrastructure middleware ===
  .use(cors(corsOrigins))
  .use(
    env.NODE_ENV === "production"
      ? rateLimit({
          max: 120,
          duration: 60000,
          errorResponse: new Response(
            JSON.stringify({ error: "Too many requests", code: "RATE_LIMITED" }),
            { status: 429, headers: { "Content-Type": "application/json" } },
          ),
        })
      : (app: Elysia) => app,
  )
  // === PUBLIC routes ===
  .use(openapiConfig)
  .use(healthRoute)
  .use(warmupRoute)
  .use(keysRoute)
  .use(statsRoute)
  .use(staticRoute)
  .use(checkUpdateRoute)
  // === PROTECTED routes ===
  .use(new Elysia().derive(authDerive).use(suggestRoute).use(addressRoute).use(keyRevokeRoute))
  .onStart(async () => {
    // Startup guards

    // 1. Turnstile test-key guard
    const TURNSTILE_TEST_KEYS = new Set([
      "1x00000000000000000000AA",
      "1x0000000000000000000000000000000AA",
    ]);
    if (env.NODE_ENV === "production") {
      if (TURNSTILE_TEST_KEYS.has(env.TURNSTILE_SITE_KEY)) {
        throw new Error(
          "TURNSTILE_SITE_KEY is the Cloudflare test key; production requires a real key",
        );
      }
      if (TURNSTILE_TEST_KEYS.has(env.TURNSTILE_SECRET_KEY)) {
        throw new Error(
          "TURNSTILE_SECRET_KEY is the Cloudflare test key; production requires a real key",
        );
      }
    } else if (TURNSTILE_TEST_KEYS.has(env.TURNSTILE_SECRET_KEY)) {
      logger.warn(
        "TURNSTILE_SECRET_KEY is the Cloudflare test key — key generation bot protection disabled in dev",
      );
    }

    // 2. PUBLIC_URL / CORS_ORIGINS consistency guard
    if (env.PUBLIC_URL) {
      if (env.CORS_ORIGINS !== "*") {
        const origins = env.CORS_ORIGINS.split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const publicOrigin = new URL(env.PUBLIC_URL).origin;
        const publicInCors = origins.some((o) => new URL(o).origin === publicOrigin);
        if (!publicInCors && origins.length > 0) {
          throw new Error(
            `PUBLIC_URL=${env.PUBLIC_URL} is not in CORS_ORIGINS=${env.CORS_ORIGINS}` +
              " — same-origin bypass will not work. Either add the origin to CORS_ORIGINS or unset PUBLIC_URL.",
          );
        }
        logger.info(
          { public_url: env.PUBLIC_URL, cors_origins: env.CORS_ORIGINS },
          "PUBLIC_URL bypass active",
        );
      }
    }

    // 3. DATABASE_URL sslmode warning (production only)
    if (env.NODE_ENV === "production") {
      if (
        !env.DATABASE_URL.includes("sslmode=require") &&
        !env.DATABASE_URL.includes("sslmode=verify")
      ) {
        logger.warn(
          { env_var: "DATABASE_URL" },
          "DATABASE_URL does not use sslmode=require — connection to PostgreSQL is unencrypted",
        );
      }
      if (
        env.DATABASE_URL_READWRITE &&
        !env.DATABASE_URL_READWRITE.includes("sslmode=require") &&
        !env.DATABASE_URL_READWRITE.includes("sslmode=verify")
      ) {
        logger.warn(
          { env_var: "DATABASE_URL_READWRITE" },
          "DATABASE_URL_READWRITE does not use sslmode=require — connection to PostgreSQL is unencrypted",
        );
      }
    }

    try {
      const sql = getSql();
      await sql`SELECT 1`;
      logger.info("Database connection pool warmed up");
    } catch (err) {
      logger.error({ err }, "Failed to warm up database connection");
    }

    // Start periodic G-NAF version check (runs every 24h, first check in 5s)
    startVersionCheckScheduler(getSql);

    await ensureCorrector();
  })
  .listen(env.PORT);

logger.info({ port: env.PORT, url: `http://localhost:${env.PORT}` }, "Server started");

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  app.stop();
  await closeDb();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export type App = typeof app;
