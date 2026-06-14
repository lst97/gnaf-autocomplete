# benchmark

Latency benchmarks. 3 scripts: full mix, per-tier, tier verification.

## OVERVIEW
Measures client-side latency against the live API. p95 < 50ms is the hard
target; `bench.ts` exits 1 if exceeded (CI-friendly).

## STRUCTURE
| File | Purpose |
|------|---------|
| `bench.ts` | 1000 mixed queries, reports p50/p95/p99/avg, exits 1 if p95 > 50ms |
| `tiers.ts` | 100 queries per tier, prints HTML table rows for the test UI |
| `verify-tiers.ts` | Asserts each query routes to expected tier, prints corrections |

## WHERE TO LOOK
- **Add a benchmark query**: add to `SAMPLE_QUERIES` in `bench.ts`; also add to `QUERIES` in `verify-tiers.ts` with expected tier
- **Add a new tier to benchmark**: add entry to `TIERS` array in `tiers.ts`; define expected latency range
- **Update test UI tier table**: run `bun run benchmark/tiers.ts` → copy the printed HTML rows into `pages/main.html`
- **Sync tier labels**: run `verify-tiers.ts` after changing the router — if it shows "MISMATCH", either fix the router OR update the test UI button labels

## CONVENTIONS
- **Bypass cache**: all benchmarks use `?no_cache=1` to measure cold-cache latency
- **Percentile calculation**: `sorted[Math.floor(sorted.length * 0.95)]` — no library, plain array math
- **Client-side timing**: `performance.now()` around `fetch()` (includes network + parse)
- **`API_URL` env var** defaults to `http://localhost:8000`
- **Warmup**: `tiers.ts` calls `POST /warmup` before measuring (idempotent)
- **Exit code**: `bench.ts` exits 1 if p95 > 50ms (CI gate for regressions)

## ANTI-PATTERNS
- **NEVER** omit `?no_cache=1` — the in-process LRU would mask real performance
- **NEVER** skip warmup in `tiers.ts` — first query of each tier is cold (slow)
- **NEVER** hardcode expected p95 < 50ms threshold — derive from `README.md` "Performance" section
- **NEVER** run `bench.ts` against a non-warmed API — first 20-30 queries are cold
- **NEVER** add a benchmark query without adding it to `verify-tiers.ts`

## GOTCHAS
- `verify-tiers.ts` prints a "Corrections needed" section when tier expectations don't match — update the test UI labels
- `tiers.ts` prints ready-to-paste HTML table rows in a delimited section
- `bench.ts` exits 1 on failure — use as CI gate for performance regressions
- Sample queries are tier-mixed (tier0/0c/1/2/4) to measure real-world performance
- `verify-tiers.ts` shows the actual tier returned for each query — diff against expected
- `tiers.ts` `AbortSignal.timeout(10_000)` per request — failed requests are counted as `fail`
- `bench.ts` prints tier stats in `Results` block: `p50 / p95 / p99 / avg / max`
- `tiers.ts` final HTML rows include `<tr><td><code>tier0</code></td><td>description</td><td>~2ms</td></tr>`
- `verify-tiers.ts` `tier4` and `tier2` are intentionally similar; the split is purely based on multi-word vs single-word
