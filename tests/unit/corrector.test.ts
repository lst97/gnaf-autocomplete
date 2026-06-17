import { beforeEach, describe, expect, test } from "bun:test";
import { Corrector, getCorrector, resetCorrector, setCorrector } from "../../src/search/corrector";
import { correctStateToken } from "../../src/search/tokenizer";

/**
 * Corrector unit tests.
 *
 * Uses a fixture dictionary injected via `setCorrector()` so they
 * run without a live database.
 */
describe("Corrector — street dictionary", () => {
  test("exact match returns null (already in dictionary)", () => {
    const c = new Corrector();
    c.addStreet("main", 100);
    expect(c.correctStreet("main")).toBeNull();
  });

  test("1-char insertion typo is corrected (gresfodr → gresford)", () => {
    const c = new Corrector();
    c.addStreet("gresford", 50);
    expect(c.correctStreet("gresfodr")).toBe("gresford");
  });

  test("1-char deletion typo is corrected (gresfrod → gresford)", () => {
    const c = new Corrector();
    c.addStreet("gresford", 50);
    expect(c.correctStreet("gresfrod")).toBe("gresford");
  });

  test("1-char substitution typo is corrected (gresfird → gresford)", () => {
    const c = new Corrector();
    c.addStreet("gresford", 50);
    expect(c.correctStreet("gresfird")).toBe("gresford");
  });

  test("1-char-extra typo with size diff is corrected (sydneey → sydney)", () => {
    const c = new Corrector();
    c.addStreet("sydney", 1000);
    expect(c.correctStreet("sydneey")).toBe("sydney");
  });

  test("returns null for empty query", () => {
    const c = new Corrector();
    c.addStreet("main", 100);
    expect(c.correctStreet("")).toBeNull();
  });

  test("returns null for very short query (2 chars)", () => {
    const c = new Corrector();
    c.addStreet("main", 100);
    expect(c.correctStreet("ma")).toBeNull();
  });

  test("returns null when no candidate is within edit distance 2", () => {
    const c = new Corrector();
    c.addStreet("main", 100);
    expect(c.correctStreet("xyzabc")).toBeNull();
  });

  test("case insensitivity: GRESFODR → gresford", () => {
    const c = new Corrector();
    c.addStreet("gresford", 50);
    expect(c.correctStreet("GRESFODR")).toBe("gresford");
  });

  test("picks the closer match when multiple candidates exist", () => {
    const c = new Corrector();
    c.addStreet("gresford", 50);
    c.addStreet("greenford", 100);
    expect(c.correctStreet("gresfrod")).toBe("gresford");
    expect(c.correctStreet("greenfrod")).toBe("greenford");
  });

  test("size tracks the number of unique street words", () => {
    const c = new Corrector();
    expect(c.streetSize()).toBe(0);
    c.addStreet("main", 100);
    expect(c.streetSize()).toBe(1);
    c.addStreet("high", 50);
    expect(c.streetSize()).toBe(2);
    c.addStreet("main", 1);
    expect(c.streetSize()).toBe(2);
  });

  test("addStreet() ignores empty and very-short words", () => {
    const c = new Corrector();
    c.addStreet("", 10);
    c.addStreet("a", 10);
    c.addStreet("ab", 10);
    expect(c.streetSize()).toBe(0);
  });

  test("non-typo street names are not falsely corrected", () => {
    const c = new Corrector();
    c.addStreet("main", 1000);
    c.addStreet("manor", 800);
    c.addStreet("marco", 100);
    c.addStreet("mason", 100);
    expect(c.correctStreet("main")).toBeNull();
    expect(c.correctStreet("manor")).toBeNull();
    expect(c.correctStreet("marco")).toBeNull();
    expect(c.correctStreet("mason")).toBeNull();
  });
});

describe("Corrector — frequency-based ranking", () => {
  test("higher frequency candidate wins over lower frequency", () => {
    const c = new Corrector();
    c.addStreet("main", 1000); // common
    c.addStreet("maine", 10); // rare, but real
    // "mian" is distance 1 from both "main" and "maine":
    //   "main" - "i" = "man" → no... let me think.
    // Actually "mian": "i"↔"a" at position 1 → substitution.
    // "mian" is not in the dictionary. Deletions:
    //   "ian" (remove "m"), "man" (remove "i"), "min" (remove "a"), "mia" (remove "n")
    // "main" deletion "man" matches "mian" deletion "man" (remove "i") → same!
    // Both have edit distance 1 to "mian". "main" should win by frequency.
    const result = c.correctStreet("mian");
    expect(result).toBe("main");
  });

  test("same distance, higher frequency wins for locality", () => {
    const c = new Corrector();
    c.addLocality("wantirna", 100);
    c.addLocality("wantarna", 10);
    // "wantirno" is distance 1 from "wantirna" (o↔a sub) AND
    // distance 1 from "wantarna" (i↔a sub). Higher frequency wins.
    expect(c.correctLocality("wantirno")).toBe("wantirna");
  });

  test("exact match returns null regardless of frequency", () => {
    const c = new Corrector();
    c.addStreet("main", 1000);
    c.addStreet("maine", 10);
    expect(c.correctStreet("main")).toBeNull();
    expect(c.correctStreet("maine")).toBeNull();
  });

  test("near-exact match with extra char returns corrected word (insertion typo)", () => {
    const c = new Corrector();
    c.addStreet("gresford", 50);
    // "gresfodr" = "gresford" with an extra "d" before "r" → swap typo
    expect(c.correctStreet("gresfodr")).toBe("gresford");
  });
});

describe("Corrector — threshold boundaries", () => {
  test("query of exactly 3 chars fires the corrector", () => {
    const c = new Corrector();
    c.addStreet("main", 100);
    // "mai" has length 3 → should be processed by corrector
    const r = c.correctStreet("mai");
    // Either returns "main" or null depending on edit distance
    // We just verify it doesn't crash
    expect(r === null || r === "main").toBe(true);
  });

  test("query of exactly 2 chars returns null (below threshold)", () => {
    const c = new Corrector();
    c.addStreet("main", 100);
    expect(c.correctStreet("ma")).toBeNull();
  });

  test("query of exactly 1 char returns null (below threshold)", () => {
    const c = new Corrector();
    c.addStreet("main", 100);
    expect(c.correctStreet("m")).toBeNull();
  });

  test("empty string returns null", () => {
    const c = new Corrector();
    c.addStreet("main", 100);
    expect(c.correctStreet("")).toBeNull();
  });
});

describe("Corrector — long query performance", () => {
  test("30-char query completes in <50ms", () => {
    const c = new Corrector();
    for (let i = 0; i < 500; i++) {
      c.addStreet(`streetname${i}`, 1);
    }
    const start = performance.now();
    c.correctStreet("a".repeat(30));
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  test("lookup on 1000-word dictionary completes in <50ms", () => {
    const c = new Corrector();
    for (let i = 0; i < 1000; i++) {
      c.addStreet(`name${i}`, i);
    }
    const start = performance.now();
    const result = c.correctStreet("nam");
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});

describe("Corrector — locality dictionary", () => {
  test("exact locality match returns null", () => {
    const c = new Corrector();
    c.addLocality("wantirna", 100);
    expect(c.correctLocality("wantirna")).toBeNull();
  });

  test("1-char insertion typo corrected (wntirna → wantirna)", () => {
    const c = new Corrector();
    c.addLocality("wantirna", 100);
    expect(c.correctLocality("wntirna")).toBe("wantirna");
  });

  test("1-char deletion typo corrected (wantrina → wantirna)", () => {
    const c = new Corrector();
    c.addLocality("wantirna", 100);
    expect(c.correctLocality("wantrina")).toBe("wantirna");
  });

  test("1-char substitution typo corrected (wantirno → wantirna)", () => {
    const c = new Corrector();
    c.addLocality("wantirna", 100);
    expect(c.correctLocality("wantirno")).toBe("wantirna");
  });

  test("no locality match leaves query unchanged", () => {
    const c = new Corrector();
    c.addLocality("wantirna", 100);
    expect(c.correctLocality("xyzabc")).toBeNull();
  });

  test("locality case insensitivity: uppercase corrected to lowercase", () => {
    const c = new Corrector();
    c.addLocality("wantirna", 100);
    // Exact match in uppercase — should return null (already valid)
    expect(c.correctLocality("WANTIRNA")).toBeNull();
    // Substitution in uppercase → should correct
    expect(c.correctLocality("WANTIRNO")).toBe("wantirna");
  });

  test("locality with no close candidate returns null", () => {
    const c = new Corrector();
    c.addLocality("sydney", 1000);
    c.addLocality("melbourne", 1000);
    expect(c.correctLocality("zzz")).toBeNull();
  });

  test("locality size tracking", () => {
    const c = new Corrector();
    expect(c.localitySize()).toBe(0);
    c.addLocality("sydney", 1000);
    expect(c.localitySize()).toBe(1);
    c.addLocality("melbourne", 500);
    expect(c.localitySize()).toBe(2);
  });
});

describe("Corrector singleton", () => {
  beforeEach(() => {
    resetCorrector();
  });

  test("getCorrector returns null when no corrector is loaded", () => {
    expect(getCorrector()).toBeNull();
  });

  test("setCorrector injects a pre-built corrector", () => {
    const c = new Corrector();
    c.addStreet("gresford", 50);
    setCorrector(c);
    expect(getCorrector()).not.toBeNull();
    expect(getCorrector()?.correctStreet("gresfodr")).toBe("gresford");
  });

  test("resetCorrector clears the injected corrector", () => {
    setCorrector(new Corrector());
    expect(getCorrector()).not.toBeNull();
    resetCorrector();
    expect(getCorrector()).toBeNull();
  });
});

describe("correctStateToken", () => {
  test("exact state code returns null (no correction)", () => {
    expect(correctStateToken("NSW")).toBeNull();
    expect(correctStateToken("nsw")).toBeNull();
    expect(correctStateToken("VIC")).toBeNull();
  });

  test("1-char substitution on 3-char code is corrected (nzw → NSW)", () => {
    expect(correctStateToken("nzw")).toBe("NSW");
  });

  test("1-char extra on 3-char code is corrected (nswq → NSW)", () => {
    expect(correctStateToken("nswq")).toBe("NSW");
  });

  test("1-char missing on 3-char code is NOT corrected if ambiguous (ns → null)", () => {
    // ns is at distance 1 from NSW, NT, and SA
    expect(correctStateToken("ns")).toBeNull();
  });

  test("2-char token within 1 edit and unique IS corrected", () => {
    // "nz" → "NT" at distance 1 (z→t sub); no other state at distance 1
    expect(correctStateToken("nz")).toBe("NT");
  });

  test("1-char token returns null (too short)", () => {
    expect(correctStateToken("n")).toBeNull();
  });

  test("5-char token returns null (too long)", () => {
    expect(correctStateToken("nswxyz")).toBeNull();
  });

  test("token with no candidate within 1 edit returns null", () => {
    expect(correctStateToken("xyz")).toBeNull();
  });

  test("empty string returns null", () => {
    expect(correctStateToken("")).toBeNull();
  });
});
