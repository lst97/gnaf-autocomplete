import { Elysia } from "elysia";
import { getReadWriteSql } from "../db/client";
import { LruCache } from "../lib/cache";
import { getRealIp } from "../lib/client-ip";
import { AppError, ERROR_CODES } from "../lib/errors";
import { logger } from "../lib/logger";
import { WARMUP_TASKS } from "../sql/warmup";

// Per-IP rate limiter: 1 warmup per 30 seconds (LRU-capped at 100k entries).
const warmupIpMap = new LruCache<string, number>(100_000, 30000);

function checkWarmupRateLimit(ip: string): boolean {
  const now = Date.now();
  const last = warmupIpMap.get(ip);
  if (last === undefined) {
    warmupIpMap.set(ip, now);
    return true;
  }
  if (now - last > 30_000) {
    warmupIpMap.set(ip, now);
    return true;
  }
  return false;
}

export const warmupRoute = new Elysia().post(
  "/warmup",
  async ({ request }) => {
    const ip = getRealIp(request);
    if (!checkWarmupRateLimit(ip)) {
      throw new AppError(
        "Too many warmup requests. Try again in 30 seconds.",
        429,
        ERROR_CODES.RATE_LIMITED,
      );
    }
    const sql = getReadWriteSql();
    const start = performance.now();
    let count = 0;

    for (const { label, sql: q, params } of WARMUP_TASKS) {
      try {
        // biome-ignore lint/suspicious/noExplicitAny: Bun.sql unsafe() accepts any[]
        await sql.unsafe(q, params as unknown as any[]);
        count++;
      } catch (err) {
        logger.warn({ label, err }, "warmup query failed");
      }
    }

    const tookMs = Math.round(performance.now() - start);
    logger.info({ queries_run: count, tookMs }, "warmup completed");

    return {
      warmed: count === WARMUP_TASKS.length,
      queries_run: count,
      took_ms: tookMs,
    };
  },
  {
    detail: {
      tags: ["Ops"],
      summary: "Warm up index cache",
      description:
        "Runs 20 representative queries to load the GIN trigram index and other indexes into PostgreSQL shared_buffers. " +
        "Use during rolling deployments to eliminate cold-start latency before routing traffic. " +
        "Idempotent — safe to call multiple times.",
    },
  },
);
