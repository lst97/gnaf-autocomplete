#!/usr/bin/env bun
/**
 * G-NAF Address Autocomplete — Latency Benchmark
 *
 * Runs 1000 random queries (mixed tiers: state+postcode, numeric prefix,
 * street prefix, fuzzy), measures client-side latency, reports p50/p95/p99.
 *
 * Exit 0 if p95 < 50ms (the hard target), exit 1 otherwise.
 *
 * Usage: bun run benchmark/bench.ts
 * Requires: database loaded, API running.
 */

const BASE_URL = process.env.API_URL ?? "http://localhost:8000";
// API key for authenticated /suggest. Generate via /keys or insert into api_keys
// table directly. If unset, benchmark will hit 401s (timings will be misleading).
const API_KEY = process.env.API_KEY ?? "";

const SAMPLE_QUERIES = [
  // Common patterns (should hit Tier 0/0b/0c)
  "sydney NSW",
  "melbourne VIC",
  "12 main st sydney",
  "200 george st sydney",
  "100 collins st melbourne",
  "5 queen st brisbane",
  "perth WA",
  "adelaide SA",
  "hobart TAS",
  "darwin NT",
  "canberra ACT",
  // Numeric prefix (Tier 0c)
  "12 sydney",
  "59 dignan crt",
  "1 bennelong point",
  "100 sydney road",
  // Street prefix (Tier 1)
  "main st sydney",
  "george st city",
  "collins st melbourne",
  "queen street city",
  // Fuzzy / typo (Tier 2)
  "sydne",
  "melbourn",
  "brsibane",
  "adeladie",
  "perh",
  "100 georg st",
  "200 quee victoria",
  "unit 5 sydney",
  "12 mian st",
  // Locality-only (Tier 0b or 1)
  "sydney nsw 2000",
  "melbourne vic 3000",
  "brisbane qld 4000",
];

async function benchmark() {
  const iterations = 1000;
  const latencies: number[] = [];

  console.log(`Running ${iterations} queries against ${BASE_URL}...\n`);

  const headers: Record<string, string> = {};
  if (API_KEY) {
    headers["X-API-Key"] = API_KEY;
    headers["Referer"] = "http://localhost";
  }

  for (let i = 0; i < iterations; i++) {
    const q = SAMPLE_QUERIES[i % SAMPLE_QUERIES.length]!;
    const start = performance.now();
    const res = await fetch(`${BASE_URL}/suggest?q=${encodeURIComponent(q)}&limit=10&no_cache=1`, { headers });
    const elapsed = performance.now() - start;
    latencies.push(elapsed);

    if (!res.ok) {
      console.error(`  ❌ Query ${i} failed (${q}): ${res.status}`);
    }
  }

  latencies.sort((a, b) => a - b);

  const p50 = latencies[Math.floor(latencies.length * 0.5)]!;
  const p95 = latencies[Math.floor(latencies.length * 0.95)]!;
  const p99 = latencies[Math.floor(latencies.length * 0.99)]!;
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

  console.log(`\nResults (${iterations} queries, ${SAMPLE_QUERIES.length} distinct queries):`);
  console.log(`  p50: ${p50.toFixed(1)}ms`);
  console.log(`  p95: ${p95.toFixed(1)}ms`);
  console.log(`  p99: ${p99.toFixed(1)}ms`);
  console.log(`  avg: ${avg.toFixed(1)}ms`);
  console.log(`  max: ${latencies[latencies.length - 1]!.toFixed(1)}ms`);

  if (p95 > 50) {
    console.error(`\n❌ FAIL: p95 (${p95.toFixed(1)}ms) exceeds 50ms target`);
    process.exit(1);
  } else {
    console.log(`\n✅ PASS: p95 (${p95.toFixed(1)}ms) is under 50ms target`);
  }
}

benchmark().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
