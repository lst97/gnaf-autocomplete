#!/usr/bin/env bun

/**
 * G-NAF PSV Loader — Orchestrator
 *
 * Strategy:
 * 1. TRUNCATE 5 staging tables
 * 2. Spawn workers loading in parallel via Bun.spawn (9 states, NSW split into 2)
 * 3. After all workers: denormalize staging_address_detail (populate _dn columns
 *    from JOINed tables) — enables GENERATED display/search_text_expanded columns
 * 4. Pre-filter retired/alias rows (DELETE before REFRESH)
 * 5. pg_prewarm staging tables into shared_buffers
 * 6. REFRESH MATERIALIZED VIEW (reads pre-computed columns from staging)
 * 7. Recreate MV indexes in parallel (6 connections, GIN with fastupdate=off)
 * 8. Prewarm + ANALYZE
 *
 * Usage: bun run scripts/load.ts
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { SQL } from "bun";
import { env } from "../src/env";
import { logger } from "../src/lib/logger";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Count the number of lines in a file using `wc -l`. Used to compute an
 * accurate row-range split point for NSW and QLD (avoids the off-by-N
 * bug from hardcoded split points).
 * Returns 0 if the file doesn't exist or wc fails.
 */
async function countFileLines(path: string): Promise<number> {
  try {
    const proc = Bun.spawn(["wc", "-l", path], { stdout: "pipe" });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    const match = output.trim().match(/^\s*(\d+)/);
    return match && match[1] ? Number.parseInt(match[1], 10) : 0;
  } catch {
    return 0;
  }
}

interface WorkerSpec {
  label: string;
  state: string;
  startRow: number;
  endRow: number;
}

/**
 * Build the worker spawn list — one worker per state (9 workers total).
 * Previously NSW and QLD were split into 2 row-range chunks each, but
 * concurrent COPY streams to the same table caused Bun runtime hangs
 * (workers stuck at 0% CPU, no DB activity). Revisit if Bun fixes the
 * issue or if we switch to a different COPY strategy.
 */
async function buildWorkerList(_dataDir: string): Promise<WorkerSpec[]> {
  return [
    { label: "ACT", state: "ACT", startRow: 0, endRow: Number.MAX_SAFE_INTEGER },
    { label: "NSW", state: "NSW", startRow: 0, endRow: Number.MAX_SAFE_INTEGER },
    { label: "NT", state: "NT", startRow: 0, endRow: Number.MAX_SAFE_INTEGER },
    { label: "OT", state: "OT", startRow: 0, endRow: Number.MAX_SAFE_INTEGER },
    { label: "QLD", state: "QLD", startRow: 0, endRow: Number.MAX_SAFE_INTEGER },
    { label: "SA", state: "SA", startRow: 0, endRow: Number.MAX_SAFE_INTEGER },
    { label: "TAS", state: "TAS", startRow: 0, endRow: Number.MAX_SAFE_INTEGER },
    { label: "VIC", state: "VIC", startRow: 0, endRow: Number.MAX_SAFE_INTEGER },
    { label: "WA", state: "WA", startRow: 0, endRow: Number.MAX_SAFE_INTEGER },
  ];
}

async function main() {
  // Single connection for the orchestrator — it's a sequential driver.
  const sql = new SQL(env.DATABASE_URL, { max: 1, min: 1 });
  const dataDir = env.GNAF_DATA_DIR;
  const sqlDir = join(__dirname, "..", "sql");

  logger.info({ dataDir }, "Starting G-NAF loader (orchestrator)");

  // Build the worker spawn list. NSW and QLD are split into 2 row-range
  // chunks each; all other states use a single worker. The split points
  // are computed from the actual file line counts (no hardcoded values).
  const WORKERS = await buildWorkerList(dataDir);
  logger.info({ workerCount: WORKERS.length, workers: WORKERS.map((w) => w.label) }, "Worker spawn list built");

  // Step 1: Schema setup — skip if ALL required objects already exist.
  const schemaCheck = await sql`
    SELECT
      EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'staging_state') AS staging_ok,
      EXISTS (SELECT FROM pg_matviews WHERE matviewname = 'address_search_mv') AS mv_ok
  `;
  if (!schemaCheck[0]?.staging_ok || !schemaCheck[0]?.mv_ok) {
    logger.info("Running schema setup...");
    for (const file of [
      "001_extensions.sql",
      "003b_abbrev_map.sql",
      "003c_expand_fn.sql",
      "005_staging.sql",
      "006_staging_indexes.sql",
      "007_mv.sql",
    ]) {
      const path = join(sqlDir, file);
      const content = readFileSync(path, "utf-8");
      // Use sql.unsafe() with the whole file — Bun's SQL supports multi-statement
      // queries when no parameters are used. This avoids manual SQL parsing which
      // breaks on dollar-quoted strings ($$...$$) and comments containing ";".
      await sql.unsafe(content);
      logger.info({ file }, "Executed SQL file");
    }
  } else {
    logger.info("Schema already applied — skipping");
  }

  // Step 2: TRUNCATE staging tables
  logger.info("Truncating staging tables...");
  await sql.unsafe(
    "TRUNCATE staging_address_detail, staging_address_geocode, staging_street_locality, staging_locality, staging_state CASCADE",
  );

  // Step 2b: Drop staging indexes — they slow down bulk INSERTs 2-3x.
  //   Recreated after the load to avoid paying the cost during the load.
  logger.info("Dropping staging indexes for load speedup...");
  await sql.unsafe(`
    DROP INDEX IF EXISTS idx_staging_sl_street_locality_pid;
    DROP INDEX IF EXISTS idx_staging_ad_locality_pid;
    DROP INDEX IF EXISTS idx_staging_locality_state_pid;
  `);

  // Step 2c: Disable autovacuum on staging tables for the duration of the load.
  //   Autovacuum would otherwise try to ANALYZE / VACUUM the growing staging
  //   tables mid-load, consuming extra memory (autovacuum_work_mem) and CPU.
  //   Re-enabled after REFRESH below.
  logger.info("Disabling autovacuum on staging tables...");
  await sql.unsafe(`
    ALTER TABLE staging_address_detail SET (autovacuum_enabled = false);
    ALTER TABLE staging_address_geocode SET (autovacuum_enabled = false);
    ALTER TABLE staging_street_locality SET (autovacuum_enabled = false);
    ALTER TABLE staging_locality SET (autovacuum_enabled = false);
    ALTER TABLE staging_state SET (autovacuum_enabled = false);
  `);

  // Step 3: Spawn workers (9 states, NSW and QLD each split into 2 row-range chunks)
  logger.info(`Spawning ${WORKERS.length} parallel worker processes...`);
  const workerPath = join(__dirname, "load-worker.ts");
  const workerPromises = WORKERS.map((w) => {
    logger.info({ label: w.label, startRow: w.startRow, endRow: w.endRow }, "Spawning worker");
    const proc = Bun.spawn(["bun", "run", workerPath, `--state=${w.state}`], {
      env: {
        ...process.env,
        GNAF_STATE: w.state,
        GNAF_STATE_LABEL: w.label,
        GNAF_START_ROW: String(w.startRow),
        GNAF_END_ROW: String(w.endRow),
        GNAF_DATA_DIR: dataDir,
      },
      stdout: "inherit",
      stderr: "inherit",
    });
    return proc.exited.then((code) => ({ label: w.label, code }));
  });

  const results = await Promise.all(workerPromises);
  const failed = results.filter((r) => r.code !== 0);
  if (failed.length > 0) {
    logger.error({ failed: failed.map((r) => r.label).join(",") }, "Some workers failed");
    throw new Error(
      `Loader workers failed: ${failed.map((r) => `${r.label}(${r.code})`).join(", ")}`,
    );
  }
  logger.info("All workers completed successfully");

  // Step 3a: Denormalize staging_address_detail via a single 4-table JOIN
  //   UPDATE (~96.5s). Runs after all workers so the JOIN sees all data.
  //   The MV reads these pre-computed columns instead of JOINing 4 tables
  //   during REFRESH.
  logger.info("Denormalizing staging_address_detail (populating _dn columns)...");
  const denormStart = performance.now();
  await sql.unsafe(`
    UPDATE staging_address_detail AS ad SET
      street_name_dn        = sl.street_name,
      street_type_code_dn   = sl.street_type_code,
      street_suffix_code_dn = sl.street_suffix_code,
      locality_name_dn      = loc.locality_name,
      state_abbreviation_dn = st.state_abbreviation
    FROM staging_street_locality sl
    JOIN staging_locality loc ON sl.locality_pid = loc.locality_pid
    JOIN staging_state    st  ON loc.state_pid  = st.state_pid
    WHERE ad.street_locality_pid = sl.street_locality_pid;
  `);
  logger.info(
    { elapsed: ((performance.now() - denormStart) / 1000).toFixed(1) },
    "Denormalization complete",
  );

  // Step 3b: Recreate staging indexes — the MV refresh doesn't depend on them,
  //   but the next loader run will need them for staging.
  logger.info("Recreating staging indexes...");
  const stagingIdxStart = performance.now();
  await sql.unsafe(readFileSync(join(sqlDir, "006_staging_indexes.sql"), "utf-8"));
  logger.info({ elapsed: ((performance.now() - stagingIdxStart) / 1000).toFixed(1) }, "Staging indexes recreated");

  // Step 3c: pg_prewarm staging tables into shared_buffers for the REFRESH.
  //   The REFRESH JOINs read from these tables; pre-warming avoids OS file
  //   cache misses during the 16M-row INSERT.
  logger.info("Prewarming staging tables into shared_buffers...");
  const prewarmStart = performance.now();
  await sql.unsafe(`
    CREATE EXTENSION IF NOT EXISTS pg_prewarm;
    SELECT pg_prewarm('staging_address_detail');
    SELECT pg_prewarm('staging_street_locality');
    SELECT pg_prewarm('staging_locality');
    SELECT pg_prewarm('staging_address_geocode');
  `);
  logger.info({ elapsed: ((performance.now() - prewarmStart) / 1000).toFixed(1) }, "Staging tables prewarmed");

  // Step 3d: Pre-filter retired/alias rows. The MV's WHERE clause was removed
  //   (the filter is now a DELETE before REFRESH). This reduces the MV row
  //   count by ~5-10% and avoids per-row WHERE evaluation during REFRESH.
  //   We also DELETE the corresponding geocode rows first to satisfy the
  //   foreign key constraint.
  logger.info("Pre-filtering retired/alias rows...");
  const filterStart = performance.now();
  await sql.unsafe(`
    DELETE FROM staging_address_geocode
    WHERE address_detail_pid IN (
      SELECT address_detail_pid FROM staging_address_detail
      WHERE date_retired IS NOT NULL OR alias_principal = 'A'
    )
  `);
  await sql.unsafe(`
    DELETE FROM staging_address_detail
    WHERE date_retired IS NOT NULL OR alias_principal = 'A'
  `);
  logger.info({ elapsed: ((performance.now() - filterStart) / 1000).toFixed(1) }, "Retired/alias rows filtered");

  // Step 3e: Drop MV indexes (except UNIQUE) for faster REFRESH.
  //   REFRESH maintains all 9 indexes during the 16M-row INSERT — the GIN
  //   trigram index alone takes ~5min. Dropping first lets REFRESH just
  //   insert data; we recreate in parallel below using 6 connections.
  //   The UNIQUE index is kept (required for CONCURRENTLY refresh + fast).
  logger.info("Dropping MV indexes for faster REFRESH...");
  const dropMvIdxStart = performance.now();
  await sql.unsafe(`
    DROP INDEX IF EXISTS idx_mv_tier0_state_postcode;
    DROP INDEX IF EXISTS idx_mv_tier0_number_first;
    DROP INDEX IF EXISTS idx_mv_tier0_state_locality;
    DROP INDEX IF EXISTS idx_mv_tier1_street_prefix;
    DROP INDEX IF EXISTS idx_mv_tier2_trgm;
    DROP INDEX IF EXISTS idx_mv_tier3_fts;
    DROP INDEX IF EXISTS idx_mv_confidence;
    DROP INDEX IF EXISTS idx_mv_postcode_prefix;
  `);
  logger.info({ elapsed: ((performance.now() - dropMvIdxStart) / 1000).toFixed(1) }, "MV indexes dropped");

  // Step 4: Refresh materialized view
  //   The MV reads pre-computed display/search_text_expanded from staging
  //   GENERATED columns — no complex expressions or function calls during
  //   the 16M-row INSERT. Expected time: ~200-300s (down from 578s).
  logger.info("Refreshing materialized view...");
  const mvStart = performance.now();
  const populated = await sql`
    SELECT ispopulated FROM pg_matviews
    WHERE matviewname = 'address_search_mv' AND schemaname = 'public'
  `;
  const useConcurrently = populated.length > 0 && populated[0]?.ispopulated === true;
  if (useConcurrently) {
    await sql.unsafe("REFRESH MATERIALIZED VIEW CONCURRENTLY address_search_mv");
  } else {
    await sql.unsafe("REFRESH MATERIALIZED VIEW address_search_mv");
  }
  const mvElapsed = ((performance.now() - mvStart) / 1000).toFixed(1);
  logger.info({ elapsed: mvElapsed, concurrent: useConcurrently }, `MV refreshed in ${mvElapsed}s`);

  // Step 4b: Recreate MV indexes in parallel using 6 connections.
  //   The GIN trigram index uses WITH (fastupdate = off) for 20-30% faster
  //   Tier 2 queries (avoids linear scan of pending list entries).
  logger.info("Recreating MV indexes in parallel (6 connections)...");
  const recreateIdxStart = performance.now();
  const indexPool = new SQL(env.DATABASE_URL, { max: 6 });
  const indexBatches: string[][] = [
    [
      `CREATE INDEX IF NOT EXISTS idx_mv_tier0_state_postcode ON address_search_mv (state, postcode) INCLUDE (address_detail_pid, display, lat, lon, confidence_norm)`,
      `CREATE INDEX IF NOT EXISTS idx_mv_tier0_number_first ON address_search_mv (state, number_first) INCLUDE (address_detail_pid, display, lat, lon, postcode, confidence_norm)`,
    ],
    [
      `CREATE INDEX IF NOT EXISTS idx_mv_tier0_state_locality ON address_search_mv (state, locality_lc text_pattern_ops) INCLUDE (address_detail_pid, display, lat, lon, postcode, confidence_norm, locality)`,
      `CREATE INDEX IF NOT EXISTS idx_mv_tier1_street_prefix ON address_search_mv (street_lc text_pattern_ops, confidence_norm DESC) INCLUDE (address_detail_pid, display, lat, lon, state, postcode, number_first, locality)`,
    ],
    [
      `CREATE INDEX IF NOT EXISTS idx_mv_tier2_trgm ON address_search_mv USING GIN (search_text_expanded gin_trgm_ops) WITH (fastupdate = off)`,
      `CREATE INDEX IF NOT EXISTS idx_mv_tier3_fts ON address_search_mv USING GIN (to_tsvector('simple', search_text_expanded))`,
    ],
    [
      `CREATE INDEX IF NOT EXISTS idx_mv_postcode_prefix ON address_search_mv (postcode text_pattern_ops) INCLUDE (address_detail_pid, display, lat, lon, state, postcode, confidence_norm)`,
    ],
  ];
  const batchPromises = indexBatches.map(async (batch) => {
    for (const stmt of batch) {
      await indexPool.unsafe(stmt);
    }
  });
  await Promise.all(batchPromises);
  await indexPool.close();
  logger.info(
    { elapsed: ((performance.now() - recreateIdxStart) / 1000).toFixed(1) },
    "MV indexes recreated in parallel",
  );

  // Step 4c: ANALYZE the MV to update query planner statistics.
  logger.info("Running ANALYZE on MV...");
  await sql.unsafe("ANALYZE address_search_mv");

  // Step 5: Verify MV row count
  const row = await sql`SELECT count(*) as cnt FROM address_search_mv`;
  logger.info({ count: Number(row[0]?.cnt ?? 0) }, "Final address_search_mv row count");

  // Step 6: Prewarm
  logger.info("Prewarming indexes...");
  await sql.unsafe(readFileSync(join(sqlDir, "005_prewarm.sql"), "utf-8"));

  // Step 7: Re-enable autovacuum on staging tables (was disabled in Step 2c).
  logger.info("Re-enabling autovacuum on staging tables...");
  await sql.unsafe(`
    ALTER TABLE staging_address_detail SET (autovacuum_enabled = true);
    ALTER TABLE staging_address_geocode SET (autovacuum_enabled = true);
    ALTER TABLE staging_street_locality SET (autovacuum_enabled = true);
    ALTER TABLE staging_locality SET (autovacuum_enabled = true);
    ALTER TABLE staging_state SET (autovacuum_enabled = true);
  `);

  await sql.close();
  logger.info("Load complete!");
}

main().catch((err) => {
  logger.error(err, "Loader failed");
  process.exit(1);
});
