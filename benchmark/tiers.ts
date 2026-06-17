#!/usr/bin/env bun
/**
 * Tier latency benchmark — runs each tier 100x, reports p50/p95/p99/avg.
 * Use the output to update the test.html tier table.
 *
 * Usage: bun run benchmark/tiers.ts
 * Requires: API at localhost:8000 (or set API_URL).
 */
import { performance } from "node:perf_hooks";

const API = process.env.API_URL ?? "http://localhost:8000";
const N = 100;

const TIERS = [
  {
    label: "tier0_locality (state+locality)",
    queries: ["syd nsw", "mel vic", "bris qld", "per wa"],
  },
  {
    label: "tier1 (street prefix)",
    queries: ["sydney", "main st", "george st", "collins st", "12 main st"],
  },
  {
    label: "tier0 (state+postcode)",
    queries: [
      "sydney nsw 2000",
      "melbourne vic 3000",
      "brisbane qld 4000",
      "perth wa 6000",
      "adelaide sa 5000",
    ],
  },
  { label: "postcode (numeric prefix)", queries: ["2000", "3000", "4000"] },
  { label: "tier4 (multi-word fallback)", queries: ["ab cd sydney", "xy zy brisbane"] },
  { label: "tier2 (single-word fallback)", queries: ["syd", "xy", "ab", "yz"] },
  { label: "tier0_number (state+number)", queries: ["1 nsw", "100 vic", "12 qld", "200 sa"] },
];

async function main() {
  console.log(`Benchmarking ${API}`);
  console.log(`System: ${process.platform} ${process.arch} | Bun ${Bun.version}`);

  try {
    const r = await fetch(`${API}/readyz`, { signal: AbortSignal.timeout(3000) });
    const d = (await r.json()) as Record<string, unknown>;
    console.log(`DB:    Postgres 18-bookworm, ${d.mv_rows ?? "?"} addresses`);
  } catch {
    console.log("DB:    (unreachable — start the API)");
  }
  console.log(`Runs:  ${N} requests per tier\n`);

  // Warmup
  console.log("Warming up...");
  try {
    await fetch(`${API}/warmup`, { method: "POST", signal: AbortSignal.timeout(30_000) });
  } catch {}
  await new Promise((r) => setTimeout(r, 1000));
  console.log("");

  interface Result {
    label: string;
    p50: number;
    p95: number;
    p99: number;
    avg: number;
    ok: number;
  }
  const results: Result[] = [];

  for (const tier of TIERS) {
    const samples: number[] = [];
    let fail = 0;
    for (let i = 0; i < N; i++) {
      const q = tier.queries[i % tier.queries.length];
      const t0 = performance.now();
      try {
        const apiKey = process.env.API_KEY ?? "";
        const headers: Record<string, string> = {};
        if (apiKey) {
          headers["X-API-Key"] = apiKey;
          headers["Referer"] = "http://localhost:8000";
        }
        const res = await fetch(`${API}/suggest?q=${encodeURIComponent(q)}&limit=10&no_cache=1`, {
          signal: AbortSignal.timeout(10_000),
          headers,
        });
        if (res.ok) samples.push(performance.now() - t0);
        else fail++;
      } catch {
        fail++;
      }
    }

    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)] ?? 0;
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
    const p99 = samples[Math.floor(samples.length * 0.99)] ?? 0;
    const avg = samples.length > 0 ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
    results.push({ label: tier.label, p50, p95, p99, avg, ok: samples.length });

    console.log(
      `  ${tier.label.padEnd(38)} ` +
        `p50=${p50.toFixed(1).padStart(5)}ms  p95=${p95.toFixed(1).padStart(5)}ms  ` +
        `p99=${p99.toFixed(1).padStart(5)}ms  avg=${avg.toFixed(1).padStart(5)}ms  ` +
        `(${samples.length}/${N} ok)`,
    );
  }

  // HTML snippet
  console.log("\n─── HTML table rows ─────────────────────────────────────────────");
  for (const r of results) {
    const lat = r.avg < 1 ? "<1ms" : `~${Math.round(r.avg)}ms`;
    const name = r.label.split(" ")[0];
    const desc = r.label.slice(r.label.indexOf(" ") + 1);
    console.log(`  <tr><td><code>${name}</code></td><td>${desc}</td><td>${lat}</td></tr>`);
  }
  console.log("─────────────────────────────────────────────────────────────────");
}

main().catch(console.error);
