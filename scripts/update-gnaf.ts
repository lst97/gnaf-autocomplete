/**
 * scripts/update-gnaf.ts — Admin CLI script for downloading and extracting
 * new G-NAF releases from data.gov.au.
 *
 * This script is ONLY accessible via `bun run scripts/update-gnaf.ts`.
 * It is NOT exposed via HTTP or any API endpoint.
 *
 * Usage:
 *   bun run scripts/update-gnaf.ts              # interactive (asks confirmation)
 *   bun run scripts/update-gnaf.ts --yes         # skip confirmation
 *   bun run scripts/update-gnaf.ts --dry-run     # preview only
 *   bun run scripts/update-gnaf.ts --version "AUG 2026"  # override version
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { getSql } from "../src/db/client";
import { env } from "../src/env";
import {
  checkForUpdates,
  getReleaseInfoFromDb,
  parseGnafReleasePage,
  setCurrentVersionInDb,
} from "../src/lib/version-check";

// ── Config ──

const LOCKFILE = "/tmp/.gnaf-update.lock";
const DATA_GOV_AU_URL = "https://data.gov.au/data/dataset/geocoded-national-address-file-g-naf";
const DOTENV_PATH = ".env";

// ── Argument parsing ──

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run") || args.includes("--dryrun");
const isYes = args.includes("--yes") || args.includes("-y");
const versionOverride =
  args.find((a) => a.startsWith("--version="))?.split("=")[1] ??
  args[args.indexOf("--version") + 1] ??
  null;

// ── Lockfile ──

function acquireLock(): void {
  if (existsSync(LOCKFILE)) {
    console.error("Another update is already in progress (lockfile exists)");
    process.exit(1);
  }
  if (isDryRun) return;
  writeFileSync(LOCKFILE, String(process.pid), "utf-8");
}

function releaseLock(): void {
  try {
    if (existsSync(LOCKFILE)) unlinkSync(LOCKFILE);
  } catch {
    // ignore
  }
}

function cleanupTempFiles(): void {
  // Clean up any .part files in /tmp
  const { readdirSync } = require("node:fs") as typeof import("fs");
  try {
    const files = readdirSync("/tmp");
    for (const f of files) {
      if (f.startsWith("gnaf-download-") && f.endsWith(".part")) {
        try {
          unlinkSync(`/tmp/${f}`);
          console.log(`Cleaned up temp file: /tmp/${f}`);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}

function cleanup(): void {
  releaseLock();
  cleanupTempFiles();
}

process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

// ── Helper: read .env ──

function readDotEnv(): Record<string, string> {
  const content = readFileSync(DOTENV_PATH, "utf-8");
  const vars: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // Remove surrounding quotes if present
    vars[key] = value.replace(/^["']|["']$/g, "");
  }
  return vars;
}

function writeDotEnv(vars: Record<string, string>): void {
  let content = readFileSync(DOTENV_PATH, "utf-8");
  const original = content;

  for (const [key, value] of Object.entries(vars)) {
    const escapedValue = value.includes(" ") ? `"${value}"` : value;
    // Replace existing key or append
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${escapedValue}`);
    } else {
      content += `\n${key}=${escapedValue}`;
    }
  }

  writeFileSync(DOTENV_PATH, content, "utf-8");

  // Show diff
  console.log("\n.env changes:");
  const origLines = original.split("\n");
  const newLines = content.split("\n");
  for (const [key, _value] of Object.entries(vars)) {
    const oldLine = origLines.find((l) => l.startsWith(`${key}=`));
    const newLine = newLines.find((l) => l.startsWith(`${key}=`));
    if (oldLine !== newLine) {
      console.log(`  - ${oldLine ?? `# ${key} (was unset)`}`);
      console.log(`  + ${newLine}`);
    }
  }
}

// ── Main ──

async function main(): Promise<void> {
  console.log("=== G-NAF Update Script ===");
  console.log();

  acquireLock();

  try {
    // ── Step 1: Detect current version ──
    const currentDotEnv = readDotEnv();
    const currentVersion = currentDotEnv.GNAF_VERSION || env.GNAF_VERSION || "MAY 2026";
    const currentDataDir = currentDotEnv.GNAF_DATA_DIR || env.GNAF_DATA_DIR || "";
    console.log(`Current version: ${currentVersion}`);
    console.log(`Current data dir: ${currentDataDir}`);
    console.log();

    // ── Step 2: Determine target version ──
    let targetVersion: string;
    let downloadUrl: string;

    if (versionOverride) {
      // Use CLI override
      targetVersion = versionOverride.toUpperCase();
      console.log(`Using version from --version flag: ${targetVersion}`);

      // Try to get the download URL from data.gov.au
      console.log("Fetching data.gov.au to find download URL...");
      const response = await fetch(DATA_GOV_AU_URL, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        console.error(`Failed to fetch data.gov.au: HTTP ${response.status}`);
        process.exit(1);
      }
      const html = await response.text();
      const parsed = parseGnafReleasePage(html);
      if (!parsed) {
        console.error("Could not parse G-NAF release page on data.gov.au");
        process.exit(1);
      }
      downloadUrl = parsed.downloadUrl;
      console.log(`Found download URL: ${downloadUrl}`);
    } else {
      // Read from DB
      const sql = getSql();
      const dbInfo = await getReleaseInfoFromDb(sql);

      if (dbInfo?.latest_available_version && dbInfo?.latest_download_url) {
        targetVersion = dbInfo.latest_available_version;
        downloadUrl = dbInfo.latest_download_url;
        console.log(`Latest available from DB: ${targetVersion}`);
      } else {
        // Fallback: fetch on the fly
        console.log("No cached version in DB, fetching data.gov.au directly...");
        const result = await checkForUpdates(currentVersion);
        if (!result) {
          console.error("Could not determine latest version from data.gov.au");
          process.exit(1);
        }
        targetVersion = result.latestVersion;
        downloadUrl = result.downloadUrl;
        console.log(`Latest available: ${targetVersion}`);
      }
    }

    console.log();

    if (targetVersion === currentVersion) {
      console.log(`Already on latest version: ${currentVersion}`);
      console.log("Nothing to do.");
      cleanup();
      return;
    }

    console.log(`Summary:`);
    console.log(`  Current: ${currentVersion}`);
    console.log(`  Target:  ${targetVersion}`);
    console.log(`  URL:     ${downloadUrl}`);
    console.log();

    // ── Step 3: Confirm ──
    if (!isYes && !isDryRun) {
      const response = await promptUser("Proceed with download? [y/N] ");
      if (response.toLowerCase() !== "y" && response.toLowerCase() !== "yes") {
        console.log("Aborted.");
        cleanup();
        return;
      }
    }

    if (isDryRun) {
      console.log("[DRY RUN] Would download from:", downloadUrl);
      console.log("[DRY RUN] Would extract to directory alongside current data dir");
      console.log(`[DRY RUN] Would update .env: GNAF_VERSION=${targetVersion}`);
      console.log(`[DRY RUN] Would update DB: current_version=${targetVersion}`);
      console.log("\nDry run complete. No changes made.");
      cleanup();
      return;
    }

    // ── Step 4: Download ──
    const zipPath = `/tmp/gnaf-download-${targetVersion.replace(/\s+/g, "_")}.zip`;
    const partPath = `${zipPath}.part`;

    console.log("Downloading...");
    const downloadResponse = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(300_000), // 5 min timeout for large ZIP
    });

    if (!downloadResponse.ok) {
      console.error(
        `Download failed: HTTP ${downloadResponse.status} ${downloadResponse.statusText}`,
      );
      cleanup();
      process.exit(1);
    }

    const contentLength = downloadResponse.headers.get("content-length");
    const totalBytes = contentLength ? Number.parseInt(contentLength, 10) : 0;

    console.log(
      `Downloading ${totalBytes > 0 ? `${(totalBytes / 1024 / 1024).toFixed(1)} MB` : "unknown size"}...`,
    );

    // Stream to file
    const writer = Bun.file(partPath).writer();
    const reader = downloadResponse.body?.getReader();
    if (!reader) {
      console.error("No response body stream");
      cleanup();
      process.exit(1);
    }

    let downloadedBytes = 0;
    let lastLogBytes = 0;
    const logInterval = 10 * 1024 * 1024; // 10 MB

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value);
      downloadedBytes += value.length;

      if (downloadedBytes - lastLogBytes >= logInterval) {
        const progress = totalBytes
          ? ` (${((downloadedBytes / totalBytes) * 100).toFixed(0)}%)`
          : "";
        console.log(`  Downloaded ${(downloadedBytes / 1024 / 1024).toFixed(1)} MB${progress}`);
        lastLogBytes = downloadedBytes;
      }
    }
    writer.end();
    await writer.flush?.();

    console.log(`Downloaded ${(downloadedBytes / 1024 / 1024).toFixed(1)} MB total`);

    // Rename .part to .zip
    try {
      // Can't rename across filesystems with fs.renameSync; use shell mv
      const mv = Bun.spawnSync(["mv", partPath, zipPath]);
      if (mv.exitCode !== 0) {
        console.error("Failed to rename downloaded file");
        cleanup();
        process.exit(1);
      }
    } catch {
      console.error("Failed to rename downloaded file");
      cleanup();
      process.exit(1);
    }

    console.log("Download complete.");
    console.log();

    // ── Step 5: Verify ZIP ──
    console.log("Verifying ZIP contents...");
    const verifyResult = Bun.spawnSync(["unzip", "-l", zipPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (verifyResult.exitCode !== 0) {
      console.error("ZIP verification failed — not a valid ZIP file");
      console.error(verifyResult.stderr?.toString() ?? "");
      try {
        unlinkSync(zipPath);
      } catch {
        // ignore
      }
      cleanup();
      process.exit(1);
    }

    const listing = verifyResult.stdout?.toString() ?? "";
    if (!/_ADDRESS_DETAIL_psv\.psv/i.test(listing)) {
      console.error("ZIP verification failed — no ADDRESS_DETAIL_psv.psv files found in archive");
      try {
        unlinkSync(zipPath);
      } catch {
        // ignore
      }
      cleanup();
      process.exit(1);
    }

    console.log("ZIP verified successfully.");
    console.log();

    // ── Step 6: Determine target directory ──
    // Derive the base G-NAF directory from the current data dir:
    //   current: /.../G-NAF/G-NAF MAY 2026/Standard
    //   new:     /.../G-NAF/G-NAF AUG 2026/Standard
    const currentParentDir = currentDataDir.replace(/\/Standard\/?$/, "");
    const gnafRoot = currentParentDir.replace(/\/G-NAF\s+[\w]+\s+\d{4}\/?$/i, "");
    const safeVersionName = `G-NAF ${targetVersion}`;
    const targetBaseDir = `${gnafRoot}/${safeVersionName}`;
    const targetStandardDir = `${targetBaseDir}/Standard`;

    console.log(`Target directory: ${targetStandardDir}`);

    if (existsSync(targetStandardDir)) {
      console.log("Directory already exists — extraction will overwrite files.");
    } else {
      console.log("Creating directory...");
      mkdirSync(targetStandardDir, { recursive: true });
    }

    // Check disk space (rough estimate: ZIP contents ~2GB)
    const dfResult = Bun.spawnSync(["df", "-k", targetStandardDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (dfResult.exitCode === 0) {
      const dfOutput = dfResult.stdout?.toString() ?? "";
      const lines = dfOutput.trim().split("\n");
      if (lines.length > 1) {
        const parts = lines[1].split(/\s+/);
        const availKB = Number.parseInt(parts[3] ?? "0", 10);
        const availGB = availKB / 1024 / 1024;
        if (availGB < 5) {
          console.error(
            `Low disk space: only ${availGB.toFixed(1)} GB available. Need at least 5 GB.`,
          );
          cleanup();
          process.exit(1);
        }
        console.log(`Available disk space: ${availGB.toFixed(1)} GB`);
      }
    }
    console.log();

    // ── Step 7: Extract ──
    console.log("Extracting ZIP...");
    const extractResult = Bun.spawnSync(["unzip", "-o", zipPath, "-d", targetBaseDir], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (extractResult.exitCode !== 0) {
      console.error("Extraction failed");
      console.error(extractResult.stderr?.toString() ?? "");
      cleanup();
      process.exit(1);
    }

    console.log("Extraction complete.");
    console.log();

    // ── Step 8: Update .env ──
    console.log("Updating .env...");
    writeDotEnv({
      GNAF_VERSION: targetVersion,
      GNAF_DATA_DIR: targetStandardDir,
    });

    // ── Step 9: Update DB ──
    console.log("Updating database...");
    const sql = getSql();
    await setCurrentVersionInDb(sql, targetVersion, downloadUrl);

    // ── Step 10: Summary ──
    console.log();
    console.log("=== Update Complete ===");
    console.log(`  Old: ${currentVersion}`);
    console.log(`  New: ${targetVersion}`);
    console.log(`  Location: ${targetStandardDir}`);
    console.log();
    console.log("Next steps:");
    console.log(`  1. Run: bun run scripts/load.ts`);
    console.log(`  2. Run: docker compose restart api`);
    console.log(`  3. Verify: bun run benchmark/bench.ts`);
    console.log();
    console.log("The old dataset has been preserved at:");
    console.log(`  ${currentParentDir}`);
  } finally {
    cleanup();
  }
}

// ── Simple stdin prompt ──

function promptUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    // Read a line from stdin
    process.stdout.write(question);
    process.stdin.once("data", (data: Buffer) => {
      resolve(data.toString().trim());
    });
    process.stdin.resume();
  });
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  cleanup();
  process.exit(1);
});
