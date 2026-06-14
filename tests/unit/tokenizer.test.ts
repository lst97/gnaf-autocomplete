import { afterEach, describe, expect, test } from "bun:test";
import {
  Corrector,
  resetCorrector,
  setCorrector,
} from "../../src/search/corrector";
import { correctStateToken, detectPostcodeFilter, detectStateFilter, tokenizeQuery } from "../../src/search/tokenizer";

describe("tokenizeQuery", () => {
  test("simple query with number", () => {
    const q = tokenizeQuery("12 main st sydney");
    expect(q.tokens).toEqual(["12", "main", "st", "sydney"]);
    expect(q.startsWithNumber).toBe(true);
    expect(q.streetNumber).toBe(12);
  });

  test("query with street prefix detection", () => {
    const q = tokenizeQuery("main street sydney");
    expect(q.streetPrefix).toBe("main");
    expect(q.streetNumber).toBeNull();
  });

  test("query without a number treats first token as street prefix", () => {
    const q = tokenizeQuery("sydney");
    // "sydney" is alphabetic, >= 3 chars, not a state → treated as street prefix
    expect(q.streetPrefix).toBe("sydney");
    expect(q.streetNumber).toBeNull();
    expect(q.tokens).toEqual(["sydney"]);
  });

  test("state detected in tokens", () => {
    const q = tokenizeQuery("sydney NSW");
    expect(q.tokens).toEqual(["sydney", "nsw"]);
    expect(detectStateFilter(q)).toBe("NSW");
  });

  test("postcode detected in tokens", () => {
    const q = tokenizeQuery("sydney 2000");
    expect(q.tokens).toEqual(["sydney", "2000"]);
    expect(detectPostcodeFilter(q)).toBe("2000");
  });

  test("locality prefix detected from last token", () => {
    const q = tokenizeQuery("12 main st syd");
    expect(q.localityPrefix).toBe("syd");
  });

  test("empty string", () => {
    const t = tokenizeQuery("");
    expect(t.tokens).toEqual([]);
    expect(t.streetNumber).toBeNull();
    expect(t.streetPrefix).toBeNull();
  });

  test("flat type 'unit' is skipped — 'unit 1/6 fortuna' → number=6, prefix=fortuna", () => {
    const t = tokenizeQuery("unit 1/6 fortuna");
    expect(t.streetNumber).toBe(6);
    expect(t.streetPrefix).toBe("fortuna");
  });

  test("'1/6' pattern is parsed as flat 1, number 6", () => {
    const t = tokenizeQuery("1/6 fortuna");
    expect(t.streetNumber).toBe(6);
    expect(t.streetPrefix).toBe("fortuna");
  });

  test("'apt 5 george' skips 'apt' to find prefix", () => {
    const t = tokenizeQuery("apt 5 george");
    expect(t.streetNumber).toBe(5);
    expect(t.streetPrefix).toBe("george");
  });

  test("'unit 1 6 fortuna street' → number=6 (not 1), prefix=fortuna", () => {
    // Space-separated: "unit" is flat type, "1" is flat number, "6" is street number
    const t = tokenizeQuery("unit 1 6 fortuna street");
    expect(t.streetNumber).toBe(6);
    expect(t.streetPrefix).toBe("fortuna");
  });
});

describe("detectStateFilter", () => {
  test("detects NSW", () => {
    const q = tokenizeQuery("sydney NSW");
    expect(detectStateFilter(q)).toBe("NSW");
  });

  test("detects VIC", () => {
    const q = tokenizeQuery("melbourne VIC");
    expect(detectStateFilter(q)).toBe("VIC");
  });

  test("no state found", () => {
    const q = tokenizeQuery("sydney");
    expect(detectStateFilter(q)).toBeNull();
  });
});

describe("detectPostcodeFilter", () => {
  test("detects 2000", () => {
    const q = tokenizeQuery("sydney 2000");
    expect(detectPostcodeFilter(q)).toBe("2000");
  });

  test("ignores 3-digit number", () => {
    const q = tokenizeQuery("sydney 200");
    expect(detectPostcodeFilter(q)).toBeNull();
  });

  test("no postcode", () => {
    const q = tokenizeQuery("sydney");
    expect(detectPostcodeFilter(q)).toBeNull();
  });
});

/**
 * Tokenizer + corrector integration tests.
 *
 * These tests inject a fixture StreetCorrector via `setCorrector()` so we
 * can assert on the corrector's effect without spinning up a real database.
 * The corrector is reset after each test to keep test isolation.
 */
// Helper: inject a corrector with street entries for testing.
function injectStreetFixture(words: Record<string, number>) {
  const c = new Corrector();
  for (const [word, freq] of Object.entries(words)) {
    c.addStreet(word, freq);
  }
  setCorrector(c);
}

// Helper: inject a corrector with locality entries for testing.
function injectLocalityFixture(entries: Record<string, number>) {
  const c = new Corrector();
  for (const [name, freq] of Object.entries(entries)) {
    c.addLocality(name, freq);
  }
  setCorrector(c);
}

describe("tokenizeQuery with corrector", () => {
  afterEach(() => {
    resetCorrector();
  });

  test("exact-match prefix flows through unchanged (no correction)", () => {
    injectStreetFixture({ gresford: 50, sydney: 1000 });
    const q = tokenizeQuery("gresford");
    expect(q.streetPrefix).toBe("gresford");
    expect(q.correctedFrom).toBeNull();
  });

  test("1-char-extra typo is corrected (gresfodr → gresford)", () => {
    injectStreetFixture({ gresford: 50 });
    const q = tokenizeQuery("gresfodr");
    expect(q.streetPrefix).toBe("gresford");
    expect(q.correctedFrom).toBe("gresfodr");
  });

  test("1-char-missing typo is corrected (gresfrod → gresford)", () => {
    injectStreetFixture({ gresford: 50 });
    const q = tokenizeQuery("gresfrod");
    expect(q.streetPrefix).toBe("gresford");
    expect(q.correctedFrom).toBe("gresfrod");
  });

  test("typo with house number is corrected and number is preserved", () => {
    injectStreetFixture({ gresford: 50 });
    const q = tokenizeQuery("31 gresfodr");
    expect(q.streetNumber).toBe(31);
    expect(q.streetPrefix).toBe("gresford");
    expect(q.correctedFrom).toBe("gresfodr");
  });

  test("1-char-extra on shorter word is corrected (sydneey → sydney)", () => {
    injectStreetFixture({ sydney: 1000 });
    const q = tokenizeQuery("sydneey");
    expect(q.streetPrefix).toBe("sydney");
    expect(q.correctedFrom).toBe("sydneey");
  });

  test("short prefix (3 chars) is not sent to corrector", () => {
    // The corrector would happily rewrite "mai" to "main" — that's
    // overreach for autocomplete. Tokenizer short-circuits prefixes <4.
    injectStreetFixture({ main: 1000 });
    const q = tokenizeQuery("mai");
    expect(q.streetPrefix).toBe("mai");
    expect(q.correctedFrom).toBeNull();
  });

  test("unrecognized word (no dictionary match) is left alone", () => {
    injectStreetFixture({ gresford: 50 });
    const q = tokenizeQuery("xyzabc");
    expect(q.streetPrefix).toBe("xyzabc");
    expect(q.correctedFrom).toBeNull();
  });

  test("tokenizer without corrector behaves as before", () => {
    // No corrector injected — typo flows through to DB unchanged (no
    // hint surfaced). The existing tier 2/4 trigram tiers handle these.
    const q = tokenizeQuery("gresfodr");
    expect(q.streetPrefix).toBe("gresfodr");
    expect(q.correctedFrom).toBeNull();
  });
});

describe("tokenizeQuery — locality corrector", () => {
  afterEach(() => {
    resetCorrector();
  });

  test("locality exact match flows through without correction", () => {
    injectLocalityFixture({ wantirna: 100 });
    const q = tokenizeQuery("31 main st wantirna");
    expect(q.localityPrefix).toBe("wantirna");
    expect(q.localityCorrectedFrom).toBeNull();
  });

  test("locality 1-char insertion typo corrected (wntirna → wantirna)", () => {
    injectLocalityFixture({ wantirna: 100 });
    const q = tokenizeQuery("31 main st wntirna");
    expect(q.localityPrefix).toBe("wantirna");
    expect(q.localityCorrectedFrom).toBe("wntirna");
  });

  test("locality with no dictionary match is left unchanged", () => {
    injectLocalityFixture({ wantirna: 100 });
    const q = tokenizeQuery("31 main st xyzabc");
    expect(q.localityPrefix).toBe("xyzabc");
    expect(q.localityCorrectedFrom).toBeNull();
  });

  test("short locality (2 chars) is not sent to corrector", () => {
    injectLocalityFixture({ sydney: 1000 });
    const q = tokenizeQuery("31 main st sy");
    expect(q.localityPrefix).toBe("sy");
    expect(q.localityCorrectedFrom).toBeNull();
  });
});

describe("detectStateFilter — state correction", () => {
  test("exact state code is detected without correction", () => {
    const q = tokenizeQuery("sydney nsw");
    expect(q.stateCorrectedFrom).toBeNull();
    expect(detectStateFilter(q)).toBe("NSW");
  });

  test("1-edit typo state code is corrected (nzw → NSW)", () => {
    const q = tokenizeQuery("sydney nzw");
    expect(q.stateCorrectedFrom).toBe("nzw");
    expect(detectStateFilter(q)).toBe("NSW");
  });

  test("ambiguous state code is not corrected (ns → null)", () => {
    const q = tokenizeQuery("sydney ns");
    expect(q.stateCorrectedFrom).toBeNull();
    expect(detectStateFilter(q)).toBeNull();
  });

  test("no state code returns null", () => {
    const q = tokenizeQuery("sydney");
    expect(q.stateCorrectedFrom).toBeNull();
    expect(detectStateFilter(q)).toBeNull();
  });
});

describe("regression: GLEN is not a street type", () => {
  test("'1167 glen huntly rd' extracts prefix='glen' not 'huntly'", () => {
    const t = tokenizeQuery("1167 glen huntly rd");
    expect(t.streetNumber).toBe(1167);
    expect(t.streetPrefix).toBe("glen");
  });

  test("'glen huntly rd' without number still extracts 'glen'", () => {
    const t = tokenizeQuery("glen huntly rd");
    expect(t.streetPrefix).toBe("glen");
    expect(t.streetNumber).toBeNull();
  });

  test("'glen waverley rd' extracts prefix='glen'", () => {
    const t = tokenizeQuery("glen waverley rd");
    expect(t.streetPrefix).toBe("glen");
  });
});

describe("regression: 1-2 char street prefixes", () => {
  test("'y street' extracts prefix='y' (1 char)", () => {
    const t = tokenizeQuery("y street");
    expect(t.streetPrefix).toBe("y");
    expect(t.streetNumber).toBeNull();
  });

  test("'pi street' extracts prefix='pi' (2 chars)", () => {
    const t = tokenizeQuery("pi street");
    expect(t.streetPrefix).toBe("pi");
    expect(t.streetNumber).toBeNull();
  });

  test("'q road' extracts prefix='q' (1 char)", () => {
    const t = tokenizeQuery("q road");
    expect(t.streetPrefix).toBe("q");
    expect(t.streetNumber).toBeNull();
  });

  test("'12 y st' extracts prefix='y' (number + 1-char street)", () => {
    const t = tokenizeQuery("12 y st");
    expect(t.streetNumber).toBe(12);
    expect(t.streetPrefix).toBe("y");
  });

  test("'k rd' extracts prefix='k' (single-char rural road)", () => {
    const t = tokenizeQuery("k rd");
    expect(t.streetPrefix).toBe("k");
    expect(t.streetNumber).toBeNull();
  });
});
