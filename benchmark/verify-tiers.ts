#!/usr/bin/env bun
/**
 * Verify which tier each query routes to.
 * Run this before updating the test page to make sure the tier labels are correct.
 *
 * Usage: bun run benchmark/verify-tiers.ts
 */
const API = process.env.API_URL ?? "http://localhost:8000";
const API_KEY = process.env.API_KEY ?? "";

const QUERIES = [
  { q: "syd nsw", expect: "tier1" },
  { q: "mel vic", expect: "tier1" },
  { q: "sydne", expect: "typo_corrected" },
  { q: "main st", expect: "tier1" },
  { q: "george st", expect: "tier1" },
  { q: "collins st melbourne", expect: "tier1" },
  { q: "12 main st sydney", expect: "tier1" },
  { q: "6 fortuna st clayton vic", expect: "tier1" },
  { q: "1090 centre rd oakleigh south vic 3167", expect: "tier1" },
  { q: "12-56 main st", expect: "tier1" },
  { q: "4 avenue sydney", expect: "tier1" },
  { q: "1 a1 sydney", expect: "tier1" },
  { q: "sydney nsw 2000", expect: "tier0" },
  { q: "melbourne vic 3000", expect: "tier0" },
  { q: "brisbane qld 4000", expect: "tier0" },
  { q: "perth wa 6000", expect: "tier0" },
  { q: "2000", expect: "postcode" },
  { q: "3000", expect: "postcode" },
  // tier1 btree prefix threshold is ≥1 char (lowered from 3), so these
  // short prefixes now hit the btree, not the GIN trigram tiers.
  { q: "ab cd sydney", expect: "tier1" },
  { q: "ab", expect: "tier1" },
  { q: "xy", expect: "tier1" },
  { q: "syd", expect: "tier1" },
  { q: "melbourn", expect: "typo_corrected" },
  { q: "gresfodr", expect: "typo_corrected" },
  { q: "gresfrod", expect: "typo_corrected" },
  { q: "31 gresfodr", expect: "typo_corrected" },
  { q: "sydneey", expect: "typo_corrected" },
  { q: "12 vic", expect: "tier0_number" },
  { q: "100 nsw", expect: "tier0_number" },
];

async function main() {
  console.log("Verifying query → tier routing\n");

  const results: { q: string; actual: string; expect: string; ok: boolean }[] = [];

  for (const { q, expect } of QUERIES) {
    try {
      const r = await fetch(`${API}/suggest?q=${encodeURIComponent(q)}&limit=1`, {
        signal: AbortSignal.timeout(5000),
        headers: API_KEY ? { "X-API-Key": API_KEY, Referer: "http://localhost.test" } : {},
      });
      const d = (await r.json()) as Record<string, unknown>;
      const actual = String(d.tier ?? "?");
      results.push({ q, actual, expect, ok: actual === expect });
    } catch (err) {
      results.push({ q, actual: `ERR: ${err}`, expect, ok: false });
    }
  }

  // Print results
  let pass = 0,
    fail = 0;
  for (const r of results) {
    const mark = r.ok ? "✅" : "❌";
    if (r.ok) pass++;
    else fail++;
    console.log(
      `  ${mark} ${r.q.padEnd(40)} actual=${r.actual.padEnd(16)} expected=${r.expect}${r.ok ? "" : " ← MISMATCH"}`,
    );
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);

  // If there are failures, print corrections
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    console.log("─── Corrections needed ───────────────────────────────");
    for (const r of failed) {
      console.log(`  ${r.q} → actual=${r.actual} (not ${r.expect})`);
    }
    console.log("──────────────────────────────────────────────────────");
  }

  // Print the correct tier groups (for copy-paste)
  const correct: Record<string, string[]> = {};
  for (const r of results) {
    const tier = r.ok ? r.actual : r.actual;
    (correct[tier] ??= []).push(r.q);
  }
  console.log("\n─── Tier groupings (verified) ──────────────────────────");
  for (const [tier, qs] of Object.entries(correct)) {
    console.log(`  ${tier}: ${qs.join(", ")}`);
  }
  console.log("───────────────────────────────────────────────────────");
}

main().catch(console.error);
