/**
 * scripts/lib/gnaf-download.ts — Shared G-NAF download and extraction utilities.
 *
 * Used by scripts/create-gnaf.ts (first-time) and scripts/update-gnaf.ts (upgrade).
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

// ── Lock ──

const LOCKFILE = "/tmp/.gnaf-update.lock";

export function acquireLock(dryRun: boolean): void {
  if (existsSync(LOCKFILE)) {
    console.error("Another update is already in progress (lockfile exists)");
    process.exit(1);
  }
  if (dryRun) return;
  writeFileSync(LOCKFILE, String(process.pid), "utf-8");
}

export function releaseLock(): void {
  try {
    if (existsSync(LOCKFILE)) unlinkSync(LOCKFILE);
  } catch {
    /* ignore */
  }
}

export function cleanupTempFiles(): void {
  const { readdirSync } = require("node:fs") as typeof import("fs");
  try {
    for (const f of readdirSync("/tmp")) {
      if (f.startsWith("gnaf-download-") && f.endsWith(".part")) {
        try {
          unlinkSync(`/tmp/${f}`);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

// ── .env helpers ──

export function readDotEnv(path = ".env"): Record<string, string> {
  try {
    const content = readFileSync(path, "utf-8");
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      vars[t.slice(0, eq).trim()] = t
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
    return vars;
  } catch {
    return {};
  }
}

export function writeDotEnv(updates: Record<string, string>, path = ".env"): void {
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    content = "";
  }
  const original = content;
  for (const [key, value] of Object.entries(updates)) {
    const v = value.includes(" ") ? `"${value}"` : value;
    const re = new RegExp(`^${key}=.*$`, "m");
    content = re.test(content) ? content.replace(re, `${key}=${v}`) : `${content}\n${key}=${v}`;
  }
  try {
    writeFileSync(path, content, "utf-8");
    for (const [key, value] of Object.entries(updates)) {
      const old = original.split("\n").find((l) => l.startsWith(`${key}=`));
      console.log(`  ${old ?? `# ${key} (unset)`} → ${key}=${value}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  Cannot update ${path}: ${msg}`);
    console.warn(
      `  Set manually: ${Object.entries(updates)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`,
    );
  }
}

// ── Download ──

export async function downloadFile(url: string, destZip: string): Promise<void> {
  const partPath = `${destZip}.part`;
  console.log("Downloading...");
  const resp = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
  const total = Number(resp.headers.get("content-length") ?? 0);
  console.log(`Size: ${total > 0 ? `${(total / 1024 / 1024).toFixed(1)} MB` : "unknown"}`);

  const writer = Bun.file(partPath).writer();
  const reader = resp.body?.getReader();
  if (!reader) throw new Error("No response body");
  let dl = 0,
    lastLog = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    writer.write(value);
    dl += value.length;
    if (dl - lastLog >= 10 * 1024 * 1024) {
      const pct = total ? ` (${((dl / total) * 100).toFixed(0)}%)` : "";
      console.log(`  ${(dl / 1024 / 1024).toFixed(1)} MB${pct}`);
      lastLog = dl;
    }
  }
  writer.end();
  await writer.flush?.();

  const mv = Bun.spawnSync(["mv", partPath, destZip]);
  if (mv.exitCode !== 0) throw new Error("Failed to rename downloaded file");
  console.log(`Downloaded ${(dl / 1024 / 1024).toFixed(1)} MB total`);
}

// ── ZIP verification ──

export function verifyZip(zipPath: string): void {
  console.log("Verifying ZIP...");
  const r = Bun.spawnSync(["unzip", "-l", zipPath], { stdio: ["ignore", "pipe", "pipe"] });
  if (r.exitCode !== 0) {
    try {
      unlinkSync(zipPath);
    } catch {
      /* ignore */
    }
    throw new Error(`Invalid ZIP (exit ${r.exitCode})`);
  }
  const listing = r.stdout?.toString() ?? "";
  if (!/_ADDRESS_DETAIL_psv\.psv/i.test(listing)) {
    try {
      unlinkSync(zipPath);
    } catch {
      /* ignore */
    }
    throw new Error("ZIP missing ADDRESS_DETAIL_psv.psv files");
  }
  console.log("ZIP verified.");
}

// ── Extraction ──

export function extractZip(zipPath: string, destDir: string): void {
  console.log("Extracting...");
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  const r = Bun.spawnSync(["unzip", "-o", zipPath, "-d", destDir], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = r.stderr?.toString().trim();
  if (r.exitCode !== 0) {
    if (stderr) console.error("unzip stderr:", stderr);
    throw new Error(`Extraction failed (exit ${r.exitCode})`);
  }
  console.log("Extraction complete.");
}

// ── Disk space check ──

export function checkDiskSpace(targetDir: string, minGB = 5): void {
  const r = Bun.spawnSync(["df", "-k", targetDir], { stdio: ["ignore", "pipe", "pipe"] });
  if (r.exitCode !== 0) return;
  const lines = r.stdout?.toString().trim().split("\n") ?? [];
  if (lines.length < 2) return;
  const avail = Number(lines[1].split(/\s+/)[3] ?? 0) / 1024 / 1024;
  if (avail < minGB) {
    console.error(`Low disk: ${avail.toFixed(1)} GB free, need ${minGB} GB`);
    process.exit(1);
  }
  console.log(`Disk free: ${avail.toFixed(1)} GB`);
}

// ── Prompt ──

export function promptUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.once("data", (data: Buffer) => resolve(data.toString().trim()));
    process.stdin.resume();
  });
}

// ── G-NAF version from data.gov.au ──

const DATA_GOV_AU = "https://data.gov.au/data/dataset/geocoded-national-address-file-g-naf";

export interface GnafReleaseInfo {
  version: string;
  downloadUrl: string;
}

export async function fetchLatestRelease(): Promise<GnafReleaseInfo> {
  const { parseGnafReleasePage } = await import("../../src/lib/version-check");
  const resp = await fetch(DATA_GOV_AU, { signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) throw new Error(`data.gov.au HTTP ${resp.status}`);
  const parsed = parseGnafReleasePage(await resp.text());
  if (!parsed) throw new Error("Could not parse data.gov.au release page");
  return { version: parsed.version, downloadUrl: parsed.downloadUrl };
}
