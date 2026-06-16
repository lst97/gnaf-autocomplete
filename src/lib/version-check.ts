/**
 * src/lib/version-check.ts — G-NAF release version checker
 *
 * Core library for checking new G-NAF releases on data.gov.au.
 * Used by both the API scheduler (src/index.ts) and the admin CLI script
 * (scripts/update-gnaf.ts).
 *
 * Dependencies: linkedom (lightweight ESM HTML parser)
 * DB access: Bun SQL client (postgres.js)
 */

import type { SQL } from "bun";
import { parseHTML } from "linkedom";
import { logger } from "./logger";

// ── Types ──

export interface ReleaseCheckResult {
  /** Extracted version label, e.g. "MAY 2026" */
  latestVersion: string;
  /** Direct download URL for the ZIP */
  downloadUrl: string;
  /** Release date (may be null if not found) */
  releaseDate: string | null;
  /** Whether this is newer than the current version */
  updateAvailable: boolean;
}

export interface ReleaseInfoRow {
  id: number;
  current_version: string;
  current_download_url: string;
  latest_available_version: string;
  latest_download_url: string;
  latest_release_date: string | null;
  update_available: boolean;
  last_checked_at: string | null;
  updated_at: string;
}

// ── Constants ──

const DATA_GOV_AU_URL = "https://data.gov.au/data/dataset/geocoded-national-address-file-g-naf";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

// ── HTML Parsing (linkedom) ──

/**
 * Parse the data.gov.au HTML page and extract the latest G-NAF GDA2020 release.
 *
 * The page has <li class="resource-item"> entries, each containing:
 *   <a class="resource-name">MAY 2026 - Geoscape G-NAF - GDA2020</a>
 *   <a class="dropdown-item resource-url-analytics" href="...">Download</a>
 *
 * We find the entry matching "Geoscape G-NAF - GDA2020" (case-insensitive)
 * and extract the version label from the beginning of the name.
 */
export function parseGnafReleasePage(html: string): {
  version: string;
  downloadUrl: string;
} | null {
  const { document } = parseHTML(html);

  const resourceItems = document.querySelectorAll("li.resource-item");

  for (const item of resourceItems) {
    const nameEl = item.querySelector(".resource-name");
    if (!nameEl?.textContent) continue;

    const name = nameEl.textContent.trim();

    // Match "MAY 2026 - Geoscape G-NAF - GDA2020" (case-insensitive)
    if (!/G-NAF\s*-\s*GDA2020/i.test(name)) continue;

    const versionMatch = name.match(/^([A-Z]+\s+\d{4})/i);
    if (!versionMatch) continue;

    const version = versionMatch[1].toUpperCase();

    const downloadLink = item.querySelector("a.dropdown-item.resource-url-analytics");
    const downloadUrl = downloadLink?.getAttribute("href") ?? "";

    if (!downloadUrl) {
      logger.warn({ version }, "Found GDA2020 resource but no download URL");
      continue;
    }

    return { version, downloadUrl };
  }

  return null;
}

// ── Core check function ──

/**
 * Fetch the data.gov.au page, parse it, and determine if a new G-NAF
 * GDA2020 release is available compared to the current version.
 *
 * @param currentVersion - The currently loaded version string (e.g. "MAY 2026")
 * @returns Check result with parsed release info, or null if the page
 *          couldn't be fetched or parsed.
 */
export async function checkForUpdates(currentVersion: string): Promise<ReleaseCheckResult | null> {
  try {
    const response = await fetch(DATA_GOV_AU_URL, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent":
          "G-NAF-Autocomplete/1.0 (version checker; https://github.com/lst97/gnaf-autocomplete)",
      },
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, statusText: response.statusText },
        "data.gov.au returned non-OK status",
      );
      return null;
    }

    const html = await response.text();
    const parsed = parseGnafReleasePage(html);

    if (!parsed) {
      logger.warn("Could not find G-NAF GDA2020 release entry on data.gov.au page");
      return null;
    }

    const updateAvailable = parsed.version !== currentVersion;
    const releaseDate = await extractReleaseDate(html);

    logger.info(
      {
        currentVersion,
        latestVersion: parsed.version,
        updateAvailable,
        downloadUrl: parsed.downloadUrl,
      },
      updateAvailable ? "New G-NAF release detected" : "G-NAF version is current",
    );

    return {
      latestVersion: parsed.version,
      downloadUrl: parsed.downloadUrl,
      releaseDate,
      updateAvailable,
    };
  } catch (err) {
    logger.error({ err }, "Failed to check for G-NAF updates on data.gov.au");
    return null;
  }
}

/**
 * Try to extract a release date from the JSON-LD structured data in the page,
 * or from a "GNAF Release Report" resource description.
 */
async function extractReleaseDate(html: string): Promise<string | null> {
  try {
    const { document } = parseHTML(html);

    const jsonld = document.querySelector('script[type="application/ld+json"]');
    if (jsonld?.textContent) {
      try {
        const data = JSON.parse(jsonld.textContent);
        const dateModified = data?.dateModified ?? data?.datePublished ?? null;
        if (dateModified) return String(dateModified).slice(0, 10);
      } catch {
        // ignore parse errors in JSON-LD
      }
    }
  } catch {
    // ignore
  }

  return null;
}

// ── DB operations ──

/**
 * Read the gnaf_release_info singleton row from the database.
 */
export async function getReleaseInfoFromDb(sql: SQL): Promise<ReleaseInfoRow | null> {
  try {
    const rows = await sql<ReleaseInfoRow[]>`SELECT * FROM gnaf_release_info WHERE id = 1`;
    return rows[0] ?? null;
  } catch (err) {
    logger.error({ err }, "Failed to read gnaf_release_info from DB");
    return null;
  }
}

/**
 * Update the gnaf_release_info row with the latest check result.
 * Only writes if the fetch + parse succeeded (checkResult is not null).
 *
 * @param currentVersion - The current version from env (e.g. "MAY 2026")
 * @param checkResult - The parsed release info from data.gov.au, or null
 */
export async function updateReleaseInfoInDb(
  sql: SQL,
  _currentVersion: string,
  checkResult: ReleaseCheckResult | null,
): Promise<void> {
  if (!checkResult) {
    // Check failed — don't update latest_* fields, but update last_checked_at
    // to track that we attempted a check
    try {
      await sql`UPDATE gnaf_release_info SET last_checked_at = now() WHERE id = 1`;
    } catch (err) {
      logger.error({ err }, "Failed to update gnaf_release_info last_checked_at");
    }
    return;
  }

  try {
    await sql`
      UPDATE gnaf_release_info SET
        latest_available_version = ${checkResult.latestVersion},
        latest_download_url = ${checkResult.downloadUrl},
        latest_release_date = ${checkResult.releaseDate ?? null}::date,
        update_available = ${checkResult.updateAvailable},
        last_checked_at = now(),
        updated_at = now()
      WHERE id = 1
    `;
  } catch (err) {
    logger.error({ err }, "Failed to update gnaf_release_info");
  }
}

/**
 * After a new dataset has been loaded (by the admin CLI script),
 * mark it as the current version in the DB.
 */
export async function setCurrentVersionInDb(
  sql: SQL,
  version: string,
  downloadUrl: string,
): Promise<void> {
  try {
    await sql`
      UPDATE gnaf_release_info SET
        current_version = ${version},
        current_download_url = ${downloadUrl},
        update_available = false,
        updated_at = now()
      WHERE id = 1
    `;
    logger.info({ version }, "Updated current version in gnaf_release_info");
  } catch (err) {
    logger.error({ err }, "Failed to update current version in gnaf_release_info");
  }
}

// ── Scheduler ──

/**
 * Start the version check scheduler. Runs an initial check immediately
 * (non-blocking, no delay to server startup), then re-checks every 24h.
 *
 * @param getSql - function that returns the current SQL client
 */
export function startVersionCheckScheduler(getSql: () => SQL): { stop: () => void } {
  let intervalId: ReturnType<typeof setInterval> | null = null;

  async function runCheck() {
    try {
      const { env } = await import("../env");
      const currentVersion = env.GNAF_VERSION || "MAY 2026";
      const sql = getSql();

      // Skip if the DB table doesn't exist yet (first startup before migrations)
      try {
        await sql`SELECT 1 FROM gnaf_release_info LIMIT 1`;
      } catch {
        logger.warn("gnaf_release_info table not found — skipping version check");
        return;
      }

      const result = await checkForUpdates(currentVersion);
      await updateReleaseInfoInDb(sql, currentVersion, result);
    } catch (err) {
      logger.error({ err }, "Version check scheduler error");
    }
  }

  // Run initial check after a short delay (don't block startup)
  setTimeout(() => {
    runCheck().catch((err) => logger.error({ err }, "Initial version check failed"));
  }, 5_000);

  intervalId = setInterval(() => {
    runCheck().catch((err) => logger.error({ err }, "Scheduled version check failed"));
  }, TWENTY_FOUR_HOURS_MS);

  return {
    stop: () => {
      if (intervalId) clearInterval(intervalId);
    },
  };
}
