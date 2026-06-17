import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { closeDb, getSql } from "../../src/db/client";
import { routeQuery } from "../../src/db/router";
import { ensureCorrector, getCorrector, setCorrector } from "../../src/search/corrector";
import { Corrector } from "../../src/search/corrector";
import { tokenizeQuery } from "../../src/search/tokenizer";

let dbOnline = false;
let correctorLoaded = false;

beforeAll(async () => {
  try {
    const sql = getSql();
    await sql`SELECT 1`;
    dbOnline = true;
    await ensureCorrector();
    correctorLoaded = true;
  } catch {
    dbOnline = false;
  }
});

afterAll(async () => {
  try {
    await closeDb();
  } catch {
    /* ignore */
  }
});

interface QueryTest {
  q: string;
  state?: string;
  postcode?: string;
  description: string;
  category: string;
}

const QUERIES: QueryTest[] = [
  { q: "1 main st", description: "number + street + type", category: "basic" },
  { q: "main st", description: "street + type only", category: "basic" },
  { q: "sydney", description: "single city name", category: "basic" },
  { q: "2000", description: "postcode only", category: "basic" },
  { q: "sydney nsw 2000", description: "state + postcode", category: "basic" },
  { q: "845 4d", description: "non-alpha prefix with number", category: "tier4" },
  { q: "1 a1", description: "1-char + non-alpha prefix", category: "tier4" },
  { q: "1 b1", description: "1-char + non-alpha prefix (b1)", category: "tier4" },
  { q: "1 e4", description: "1-char + non-alpha prefix (e4)", category: "tier4" },
  { q: "845 4d caroona", description: "non-alpha prefix + locality", category: "tier4" },
  { q: "main street sydney nsw", description: "full address 4 tokens", category: "tier4" },
  { q: "1 main street sydney nsw 2000", description: "full address 6 tokens", category: "long" },
  {
    q: "1 main street sydney nsw 2000 australia",
    description: "7 tokens with country",
    category: "long",
  },
  {
    q: "unit 5 12 main street sydney nsw 2000",
    description: "flat + full address 7 tokens",
    category: "long",
  },
  {
    q: "level 3 unit 5 12 main street sydney nsw 2000",
    description: "level + flat + full 8 tokens",
    category: "long",
  },
  { q: "a", description: "single letter", category: "short" },
  { q: "ab", description: "2 letters", category: "short" },
  { q: "1 a", description: "number + 1-letter", category: "short" },
  { q: "1 ab", description: "number + 2-letters", category: "short" },
  { q: "12 nsw", description: "number + state", category: "state" },
  { q: "sydney nsw", description: "city + state", category: "state" },
  { q: "main nsw", description: "street + state", category: "state" },
  { q: "main nsw 2000", description: "street + state + postcode", category: "state" },
  { q: "sydney nsw 2000 australia", description: "full address with country", category: "state" },
  { q: "unit 5 12 main", description: "flat + flat-num + street-num + street", category: "flat" },
  { q: "apt 2 6 george st", description: "apt pattern", category: "flat" },
  { q: "flat 3 8 high st", description: "flat pattern", category: "flat" },
  { q: "level 3 50 main st", description: "level pattern", category: "flat" },
  { q: "shop 12 100 george st", description: "shop pattern", category: "flat" },
  { q: "5/12 main st", description: "X/Y flat pattern", category: "flat" },
  { q: "u2 6 main", description: "flat type prefixed u2", category: "flat" },
  { q: "unit5 12 main", description: "flat type prefixed unit5", category: "flat" },
  { q: "10-20 main st", description: "number range", category: "range" },
  { q: "1-6 fortuna", description: "range + street", category: "range" },
  { q: "1/6 fortuna", description: "X/Y number pattern", category: "range" },
  { q: "1-2/3-4 main st", description: "complex range", category: "range" },
  { q: ",12 main st,", description: "leading/trailing commas", category: "special" },
  { q: "12  main  st", description: "multiple spaces", category: "special" },
  { q: "12-MAIN-ST", description: "uppercase with hyphens", category: "special" },
  { q: "12 main-st sydney", description: "hyphenated street", category: "special" },
  { q: "12 o'connell st", description: "apostrophe in street", category: "special" },
  { q: "12 main clayton south", description: "multi-word locality", category: "locality" },
  { q: "12 main mount waverley", description: "multi-word locality 2", category: "locality" },
  { q: "12 main glen huntly", description: "multi-word locality 3", category: "locality" },
  {
    q: "4 avenue sydney",
    description: "avenue street (post-fix)",
    category: "street-name-conflict",
  },
  {
    q: "1 close canterbury",
    description: "close street (post-fix)",
    category: "street-name-conflict",
  },
  { q: "12 main", description: "most common street name", category: "common" },
  { q: "main", description: "common street", category: "common" },
  { q: "the", description: "stopword", category: "edge" },
  { q: "a b c d e f", description: "6 single letters", category: "edge" },
  { q: "12 34 56 78", description: "all numbers", category: "edge" },
  { q: "1 gresfodr", description: "typo of gresford", category: "typo" },
  { q: "1 sydneey", description: "typo of sydney", category: "typo" },
  { q: "1 main st sydneey", description: "typo of sydney in context", category: "typo" },
];

const SLOW_THRESHOLD_MS = 1000;

describe("performance: query latency sweep", () => {
  test("identify any queries that exceed 1s threshold", async () => {
    if (!dbOnline) return;
    const slowQueries: Array<{ q: string; description: string; elapsed: number; tier: string }> =
      [];
    const fastQueries: Array<{ q: string; description: string; elapsed: number; tier: string }> =
      [];

    for (const qt of QUERIES) {
      const r = routeQuery(qt.q, qt.state ?? null, qt.postcode ?? null, 10, 0);
      const start = performance.now();
      let rows: any[] = [];
      try {
        rows = await r.sql;
      } catch {
        /* ignore */
      }
      const elapsed = performance.now() - start;

      const entry = { q: qt.q, description: qt.description, elapsed, tier: r.tier };
      if (elapsed > SLOW_THRESHOLD_MS) {
        slowQueries.push(entry);
      } else {
        fastQueries.push(entry);
      }
    }

    console.log("\n=== Query latency summary ===");
    const byCategory = new Map<string, typeof fastQueries>();
    for (const e of fastQueries) {
      const cat = QUERIES.find((q) => q.q === e.q)?.category ?? "unknown";
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(e);
    }
    for (const [cat, entries] of byCategory) {
      const avg = entries.reduce((a, b) => a + b.elapsed, 0) / entries.length;
      const max = Math.max(...entries.map((e) => e.elapsed));
      console.log(`  ${cat}: avg=${avg.toFixed(1)}ms max=${max.toFixed(1)}ms n=${entries.length}`);
    }

    if (slowQueries.length > 0) {
      console.log(`\n=== SLOW QUERIES (>${SLOW_THRESHOLD_MS}ms) ===`);
      for (const e of slowQueries) {
        console.log(`  ${e.elapsed.toFixed(0)}ms [${e.tier}] "${e.q}" (${e.description})`);
      }
    } else {
      console.log(`\n=== No queries exceeded ${SLOW_THRESHOLD_MS}ms ===`);
    }

    expect(slowQueries.length).toBe(0);
  }, 120000);
});

describe("performance: corrector long-query sweep", () => {
  test("identify corrector inputs that take >50ms", () => {
    const c = new Corrector();
    for (let i = 0; i < 1000; i++) {
      c.addStreet(`streetname${i}`, i);
    }
    for (let i = 0; i < 1000; i++) {
      c.addStreet(`avenue${i}`, i);
    }

    const inputs = [
      "a".repeat(50),
      "abcdefghijklmnopqrstuvwxyz",
      "gresford",
      "gresfodr",
      "verylongstreetnametypo",
      "s",
      "",
      "x",
    ];

    const slow: Array<{ input: string; elapsed: number }> = [];
    for (const input of inputs) {
      const start = performance.now();
      c.correctStreet(input);
      const elapsed = performance.now() - start;
      if (elapsed > 50) {
        slow.push({ input: input.slice(0, 20) + (input.length > 20 ? "..." : ""), elapsed });
      }
    }

    if (slow.length > 0) {
      console.log("=== Slow corrector inputs (>50ms) ===");
      for (const e of slow) {
        console.log(`  ${e.elapsed.toFixed(1)}ms "${e.input}"`);
      }
    }

    expect(slow.length).toBe(0);
  });
});
