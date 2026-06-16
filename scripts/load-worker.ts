#!/usr/bin/env bun
/**
 * G-NAF PSV Loader — Worker
 *
 * Loads one state's worth of data into the 5 staging tables.
 * Each worker streams PSVs using Bun.file().stream() and pipes them through
 * a Transform that converts pipe-delimited rows into Postgres COPY text format,
 * then into COPY FROM STDIN via the postgres package.
 *
 * v3.0: switched back to `postgres` package + COPY FROM STDIN for bulk loading.
 *   COPY streams data directly from file to heap, bypassing shared_buffers and
 *   the JS-side parameter array. This reduces peak memory ~10-25x vs bulk INSERT
 *   (the OS file cache no longer fills with staging pages because COPY writes
 *   sequentially without dirtying shared_buffers).
 *
 * Usage: bun run scripts/load-worker.ts --state NSW
 */

import postgres from "postgres";
import { env } from "../src/env";
import { logger } from "../src/lib/logger";

// PSV column indices (0-based) — verified against actual G-NAF May 2026 headers
// ADDRESS_DETAIL: 35 total columns. LOT_NUMBER_* at 5,6,7; FLAT_TYPE at 8; etc.
const AD = {
  PID: 0,
  DATE_RETIRED: 3,
  BUILDING_NAME: 4,
  LOT_PREFIX: 5,
  LOT_NUMBER: 6,
  LOT_SUFFIX: 7,
  FLAT_TYPE: 8,
  FLAT_NUM_PREFIX: 9,
  FLAT_NUM: 10,
  FLAT_NUM_SUFFIX: 11,
  LEVEL_TYPE: 12,
  LEVEL_NUM_PREFIX: 13,
  LEVEL_NUM: 14,
  LEVEL_NUM_SUFFIX: 15,
  NUM_FIRST_PREFIX: 16,
  NUM_FIRST: 17,
  NUM_FIRST_SUFFIX: 18,
  NUM_LAST_PREFIX: 19,
  NUM_LAST: 20,
  NUM_LAST_SUFFIX: 21,
  STREET_PID: 22,
  LOCALITY_PID: 24,
  ALIAS: 25,
  POSTCODE: 26,
  CONFIDENCE: 29,
} as const;

/**
 * Per-stage loader config. Each stage specifies which PSV columns to extract
 * (0-based indices) and how many PSV columns to skip before data starts.
 */
const STAGE_CONFIG: Record<
  string,
  {
    suffix: string;
    columns: string[];
    /** Indices into the PSV row (after split('|')) for each output column. */
    indices: number[];
    /** True if the first line is a header row to skip. */
    hasHeader: boolean;
  }
> = {
  state: {
    suffix: "STATE",
    columns: ["state_pid", "state_name", "state_abbreviation"],
    indices: [0, 3, 4],
    hasHeader: true,
  },
  locality: {
    suffix: "LOCALITY",
    columns: ["locality_pid", "locality_name", "primary_postcode", "state_pid"],
    indices: [0, 3, 4, 6],
    hasHeader: true,
  },
  street_locality: {
    suffix: "STREET_LOCALITY",
    columns: [
      "street_locality_pid",
      "street_name",
      "street_type_code",
      "street_suffix_code",
      "locality_pid",
    ],
    indices: [0, 4, 5, 6, 7],
    hasHeader: true,
  },
  address_detail: {
    suffix: "ADDRESS_DETAIL",
    columns: [
      "address_detail_pid",
      "flat_type_code",
      "flat_number",
      "flat_number_prefix",
      "flat_number_suffix",
      "level_type_code",
      "level_number",
      "level_number_prefix",
      "level_number_suffix",
      "number_first",
      "number_first_prefix",
      "number_first_suffix",
      "number_last",
      "number_last_prefix",
      "number_last_suffix",
      "street_locality_pid",
      "locality_pid",
      "postcode",
      "confidence",
      "alias_principal",
      "building_name",
      "date_retired",
    ],
    indices: [
      AD.PID,
      AD.FLAT_TYPE,
      AD.FLAT_NUM,
      AD.FLAT_NUM_PREFIX,
      AD.FLAT_NUM_SUFFIX,
      AD.LEVEL_TYPE,
      AD.LEVEL_NUM,
      AD.LEVEL_NUM_PREFIX,
      AD.LEVEL_NUM_SUFFIX,
      AD.NUM_FIRST,
      AD.NUM_FIRST_PREFIX,
      AD.NUM_FIRST_SUFFIX,
      AD.NUM_LAST,
      AD.NUM_LAST_PREFIX,
      AD.NUM_LAST_SUFFIX,
      AD.STREET_PID,
      AD.LOCALITY_PID,
      AD.POSTCODE,
      AD.CONFIDENCE,
      AD.ALIAS,
      AD.BUILDING_NAME,
      AD.DATE_RETIRED,
    ],
    hasHeader: true,
  },
  address_geocode: {
    suffix: "ADDRESS_DEFAULT_GEOCODE",
    columns: ["address_detail_pid", "longitude", "latitude"],
    indices: [3, 5, 6],
    hasHeader: true,
  },
};

/**
 * Convert one PSV line to a COPY text format line.
 * Empty fields become \N (NULL). Backslashes, tabs, newlines, CRs are escaped.
 */
function psvLineToCopyLine(line: string, indices: number[]): string {
  const cols = line.split("|");
  const out: string[] = [];
  for (const idx of indices) {
    const v = cols[idx] ?? "";
    if (v === "") {
      out.push("\\N");
    } else {
      out.push(
        v
          .replace(/\\/g, "\\\\")
          .replace(/\t/g, "\\t")
          .replace(/\n/g, "\\n")
          .replace(/\r/g, "\\r"),
      );
    }
  }
  return `${out.join("\t")}\n`;
}

async function copyStage(
  sql: postgres.Sql,
  state: string,
  stage: string,
  cfg: (typeof STAGE_CONFIG)[string],
  dataDir: string,
  startRow: number,
  endRow: number,
): Promise<number> {
  const path = `${dataDir}/${state}_${cfg.suffix}_psv.psv`;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    logger.warn({ path }, "PSV file not found, skipping");
    return 0;
  }

  const startTime = performance.now();
  logger.info({ state, stage, path, startRow, endRow }, "Loading");

  // stage and column names come from our own config (not user input),
  // so sql.unsafe() is safe here.
  const colList = cfg.columns.join(", ");
  const copySql = `COPY staging_${stage} (${colList}) FROM STDIN`;

  // .writable() returns a writable stream we pipe data INTO — opposite of
  // SELECT streams where we read FROM the stream.
  const writable = await sql.unsafe(copySql).writable();

  // Read the file as a web ReadableStream and iterate chunks directly.
  // Avoids Readable.fromWeb() compatibility issues with the postgres
  // package's writable stream in Bun.
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";
  // Only the first chunk (startRow=0) skips the header row.
  let isFirstLine = cfg.hasHeader && startRow === 0;
  let rowCount = 0;
  // Track which data row index we're at (0-based, excluding header).
  let dataRowIndex = 0;
  // Flag to signal early exit from the outer read loop.
  let doneEarly = false;

  try {
    while (!doneEarly) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (isFirstLine) {
          isFirstLine = false;
          continue;
        }
        if (!line) continue;
        // Row-range filter: only process rows in [startRow, endRow).
        if (dataRowIndex >= startRow && dataRowIndex < endRow) {
          writable.write(psvLineToCopyLine(line, cfg.indices));
          rowCount++;
        }
        dataRowIndex++;
        // Early exit if we've processed all rows in our range.
        if (dataRowIndex >= endRow) {
          doneEarly = true;
          break;
        }
      }
    }

    // Last line (if no trailing newline) — apply row-range filter
    if (buf.length > 0 && !isFirstLine && dataRowIndex >= startRow && dataRowIndex < endRow) {
      writable.write(psvLineToCopyLine(buf, cfg.indices));
      rowCount++;
    }
  } finally {
    reader.releaseLock();
  }

  // Signal end of COPY data. writable.end() sends the COPY terminator to
  // the server. The 'finish' event fires when the server acknowledges.
  // COPY runs in autocommit mode in postgres.js — data is committed as
  // soon as the server acks the terminator.
  writable.end();
  await new Promise<void>((resolve, reject) => {
    writable.on("finish", () => resolve());
    writable.on("error", reject);
  });

  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  logger.info(
    { state, stage, rows: rowCount, elapsed },
    `${state}/${stage}: ${rowCount.toLocaleString()} rows in ${elapsed}s`,
  );
  return rowCount;
}

async function loadState(
  state: string,
  dataDir: string,
  sql: postgres.Sql,
  startRow = 0,
  endRow = Number.MAX_SAFE_INTEGER,
): Promise<void> {
  for (const [stage, cfg] of Object.entries(STAGE_CONFIG)) {
    await copyStage(sql, state, stage, cfg, dataDir, startRow, endRow);
  }
}

// ============================================================================
// MAIN
// ============================================================================
async function main() {
  const state = env.GNAF_STATE;
  if (!state) {
    logger.error("GNAF_STATE environment variable not set");
    process.exit(1);
  }
  const label = env.GNAF_STATE_LABEL ?? state;
  // Row-range parameters for NSW splitting. Default: process all rows.
  // startRow=0 means "first chunk — also skip the header row"
  // startRow>0 means "subsequent chunk — header already skipped by chunk 0"
  const startRow = env.GNAF_START_ROW ?? 0;
  const endRow = env.GNAF_END_ROW ?? Number.MAX_SAFE_INTEGER;

  const dataDir = env.GNAF_DATA_DIR;
  if (!dataDir) {
    logger.error("GNAF_DATA_DIR environment variable is required");
    return;
  }
  const dbUrl = env.DATABASE_URL;

  // max: 1 — workers are single-threaded; the default pool would create
  // multiple connections per worker and exhaust the server's max_connections.
  // postgres.js with COPY FROM STDIN streams data sequentially on one
  // connection, so a single connection is correct and fastest.
  const sql = postgres(dbUrl, { max: 1 });
  logger.info({ label, state, startRow, endRow, dataDir }, "Worker started");

  try {
    await loadState(state, dataDir, sql, startRow, endRow);
    logger.info({ label }, "Worker completed");
  } catch (err) {
    logger.error({ label, err }, "Worker failed");
    throw err;
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Worker error:", err);
  process.exit(1);
});
