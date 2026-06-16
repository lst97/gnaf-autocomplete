#!/usr/bin/env bun
/**
 * scripts/create-gnaf.ts — First-time G-NAF dataset download.
 *
 * Downloads the latest G-NAF release from data.gov.au, extracts it, and
 * updates .env with GNAF_DATA_DIR and GNAF_VERSION. Designed for fresh
 * installs (no existing data). For upgrades, use update-gnaf.ts.
 *
 * Usage:
 *   bun run scripts/create-gnaf.ts                      # auto-detect latest
 *   bun run scripts/create-gnaf.ts --version "AUG 2026"  # specific version
 *   bun run scripts/create-gnaf.ts --dir /custom/path    # custom output dir
 *   bun run scripts/create-gnaf.ts --dry-run             # preview only
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  acquireLock,
  checkDiskSpace,
  cleanupTempFiles,
  downloadFile,
  extractZip,
  fetchLatestRelease,
  readDotEnv,
  releaseLock,
  verifyZip,
  writeDotEnv,
} from "./lib/gnaf-download";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run") || args.includes("--dryrun");
const versionOverride =
  args.find((a) => a.startsWith("--version="))?.split("=")[1] ??
  (() => {
    const idx = args.indexOf("--version");
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
  })() ??
  null;
const dirOverride =
  args.find((a) => a.startsWith("--dir="))?.split("=")[1] ??
  (() => {
    const idx = args.indexOf("--dir");
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
  })() ??
  null;

// Priority: --dir CLI arg > GNAF_DATA_ROOT env var > cwd
const dataRoot = process.env.GNAF_DATA_ROOT ?? "";

function cleanup(): void {
  releaseLock();
  cleanupTempFiles();
}
process.on("SIGINT", () => { cleanup(); process.exit(130); });
process.on("SIGTERM", () => { cleanup(); process.exit(143); });

/**
 * Scan `rootDir` for a `Standard/` directory containing G-NAF PSV files.
 * The G-NAF ZIP may extract as:
 *   G-NAF/G-NAF MAY 2026/Standard/   (with G-NAF/ prefix)
 * or directly as:
 *   G-NAF MAY 2026/Standard/         (without prefix)
 * This function finds whichever one exists.
 */
function findStandardDir(rootDir: string, version: string): string | null {
  const candidates = [
    join(rootDir, version, "Standard"),
    join(rootDir, `G-NAF ${version}`, "Standard"),
    join(rootDir, "G-NAF", `G-NAF ${version}`, "Standard"),
    join(rootDir, "G-NAF", version, "Standard"),
  ];
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir);
      if (entries.some((e) => e.endsWith("_ADDRESS_DETAIL_psv.psv"))) return dir;
    } catch { /* not accessible */ }
  }
  return null;
}

async function main(): Promise<void> {
  console.log("=== G-NAF First-Time Download ===\n");

  acquireLock(isDryRun);

  try {
    // ── Step 1: Check existing ──
    const env = readDotEnv();
    const existingDir = env.GNAF_DATA_DIR ?? "";
    if (existingDir && existsSync(existingDir)) {
      const sampleFile = join(existingDir, "NSW_ADDRESS_DETAIL_psv.psv");
      if (existsSync(sampleFile)) {
        console.log(`G-NAF data already exists at: ${existingDir}`);
        console.log("Nothing to do. For upgrades, use: bun run scripts/update-gnaf.ts");
        cleanup();
        return;
      }
    }

    // ── Step 2: Determine target version ──
    // Priority: --version CLI arg > GNAF_VERSION env var > auto-detect
    let targetVersion: string;
    let downloadUrl: string;
    const envVersion = process.env.GNAF_VERSION ?? "";

    if (versionOverride) {
      targetVersion = versionOverride.toUpperCase();
      console.log("Fetching data.gov.au for download URL...");
      const info = await fetchLatestRelease();
      downloadUrl = info.downloadUrl;
      console.log(`Version: ${targetVersion} · URL: ${downloadUrl}`);
    } else if (envVersion) {
      targetVersion = envVersion.toUpperCase();
      console.log(`Using GNAF_VERSION env: ${targetVersion}`);
      console.log("Fetching data.gov.au for download URL...");
      const info = await fetchLatestRelease();
      downloadUrl = info.downloadUrl;
      console.log(`URL: ${downloadUrl}`);
    } else {
      console.log("Detecting latest release from data.gov.au...");
      const info = await fetchLatestRelease();
      targetVersion = info.version;
      downloadUrl = info.downloadUrl;
      console.log(`Latest: ${targetVersion}`);
    }

    console.log();

    // ── Step 3: Determine target directory ──
    // Priority: --dir CLI arg > GNAF_DATA_ROOT env var > cwd
    const baseDir = dirOverride ?? (dataRoot || process.cwd());
    const safeName = `G-NAF ${targetVersion}`;
    const targetDir = join(baseDir, safeName, "Standard");

    console.log(`Target: ${targetDir}`);

    if (existsSync(targetDir)) {
      console.log("Directory exists — extraction will overwrite files.");
    }

    checkDiskSpace(targetDir);

    if (isDryRun) {
      console.log("\n[DRY RUN] Would download from:", downloadUrl);
      console.log("[DRY RUN] Would extract to:", targetDir);
      console.log(`[DRY RUN] Would set: GNAF_DATA_DIR=${targetDir} · GNAF_VERSION=${targetVersion}`);
      console.log("Dry run complete. No changes made.");
      cleanup();
      return;
    }

    // ── Step 4: Download ──
    const zipPath = `/tmp/gnaf-create-${targetVersion.replace(/\s+/g, "_")}.zip`;
    await downloadFile(downloadUrl, zipPath);

    // ── Step 5: Verify ──
    verifyZip(zipPath);

    // ── Step 6: Extract ──
    extractZip(zipPath, baseDir);

    // ── Step 7: Verify extraction ──
    // The ZIP may contain a G-NAF/ prefix, so scan for the actual Standard/ dir
    const actualDir = findStandardDir(baseDir, targetVersion);
    if (!actualDir) {
      console.error("Extraction finished but Standard/ with PSV files not found.");
      console.error(`Searched in: ${baseDir}`);
      cleanup();
      process.exit(1);
    }
    console.log(`Data extracted to: ${actualDir}`);

    // ── Step 8: Update .env ──
    console.log("Updating .env...");
    writeDotEnv({
      GNAF_DATA_DIR: actualDir,
      GNAF_VERSION: targetVersion,
    });

    // ── Done ──
    console.log(`\n=== Download Complete ===`);
    console.log(`  Version: ${targetVersion}`);
    console.log(`  Location: ${actualDir}`);
    console.log(`\nNext: bun run scripts/load.ts`);
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  cleanup();
  process.exit(1);
});
