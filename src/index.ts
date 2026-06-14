import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { rateLimit } from "elysia-rate-limit";
import { addressRoute } from "./api/address";
import { authDerive } from "./api/auth";
import { healthRoute } from "./api/health";
import { keysRoute } from "./api/keys";
import { openapiConfig } from "./api/openapi";
import { staticRoute } from "./api/static";
import { statsRoute } from "./api/stats";
import { suggestRoute } from "./api/suggest";
import { warmupRoute } from "./api/warmup";
import { getConfig } from "./config";
import { closeDb, getSql } from "./db/client";
import { AppError, ERROR_CODES } from "./lib/errors";
import { logger } from "./lib/logger";
import { getOrGenerateRequestId } from "./lib/request";
import { ensureCorrector } from "./search/corrector";
import type { ResponseMeta } from "./types";

const config = getConfig();

const corsOrigins =
  config.CORS_ORIGINS === "*"
    ? { origin: "*" }
    : { origin: config.CORS_ORIGINS.split(",").map((s) => s.trim()) };

function buildResponseMeta(request: Request): ResponseMeta {
  return {
    took_ms: 0, // filled after handler runs
    request_id: getOrGenerateRequestId(request),
    timestamp: new Date().toISOString(),
  };
}

const app = new Elysia()
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
      return new Response(JSON.stringify({ error: "Route not found", code: "NOT_FOUND", meta }), {
        status: 404,
        headers: { "Content-Type": "application/json", "X-Request-Id": meta.request_id },
      });
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
    process.env.NODE_ENV === "production"
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
  // === PROTECTED routes ===
  .use(new Elysia().derive(authDerive).use(suggestRoute).use(addressRoute))
  .onStart(async () => {
    try {
      const sql = getSql();
      await sql`SELECT 1`;
      logger.info("Database connection pool warmed up");
    } catch (err) {
      logger.error({ err }, "Failed to warm up database connection");
    }
    await ensureCorrector();
  })
  .listen(config.PORT);

logger.info({ port: config.PORT, url: `http://localhost:${config.PORT}` }, "Server started");

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  app.stop();
  await closeDb();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export type App = typeof app;
