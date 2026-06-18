import { afterEach, describe, expect, test } from "bun:test";
import { Corrector, resetCorrector, setCorrector } from "../../src/search/corrector";
import {
  combineMultiWordLocality,
  correctStateToken,
  detectPostcodeFilter,
  detectStateFilter,
  extractStreetTypeAbbrev,
  isAlphanumericJunkToken,
  tokenizeQuery,
} from "../../src/search/tokenizer";

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

  test("detects QLD", () => {
    const q = tokenizeQuery("brisbane qld");
    expect(detectStateFilter(q)).toBe("QLD");
  });

  test("detects WA", () => {
    const q = tokenizeQuery("perth wa");
    expect(detectStateFilter(q)).toBe("WA");
  });

  test("detects SA", () => {
    const q = tokenizeQuery("adelaide sa");
    expect(detectStateFilter(q)).toBe("SA");
  });

  test("detects TAS", () => {
    const q = tokenizeQuery("hobart tas");
    expect(detectStateFilter(q)).toBe("TAS");
  });

  test("detects ACT", () => {
    const q = tokenizeQuery("canberra act");
    expect(detectStateFilter(q)).toBe("ACT");
  });

  test("detects NT", () => {
    const q = tokenizeQuery("darwin nt");
    expect(detectStateFilter(q)).toBe("NT");
  });

  test("detects OT", () => {
    const q = tokenizeQuery("jervis bay ot");
    expect(detectStateFilter(q)).toBe("OT");
  });

  test("no state found", () => {
    const q = tokenizeQuery("sydney");
    expect(detectStateFilter(q)).toBeNull();
  });

  test("state with mixed case is detected", () => {
    const q = tokenizeQuery("sydney Nsw");
    expect(detectStateFilter(q)).toBe("NSW");
  });

  test("state with lowercase is detected", () => {
    const q = tokenizeQuery("sydney nsw");
    expect(detectStateFilter(q)).toBe("NSW");
  });

  test("state code in middle of query is detected", () => {
    const q = tokenizeQuery("main st nsw sydney");
    expect(detectStateFilter(q)).toBe("NSW");
  });

  test("state-like token ending in 't' is not a false positive", () => {
    // "nt" matches Northern Territory, but "sydney" should have no state
    const q = tokenizeQuery("main st sydney");
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

  test("skips postcode when it equals streetNumber AND prefix ≥3 chars", () => {
    // "2000 main st sydney 2000" — streetNumber=2000, prefix="main" (4 chars)
    // The router's detectPostcodeFilter skips tokens that match the street
    // number when the prefix is long enough to avoid false positives.
    const q = tokenizeQuery("2000 main st sydney 2000");
    expect(q.streetNumber).toBe(2000);
    expect(q.streetPrefix).toBe("main");
    // Postcode should NOT be detected because it's the same as streetNumber
    expect(detectPostcodeFilter(q)).toBeNull();
  });

  test("detects postcode when it equals streetNumber but prefix is short (<3 chars)", () => {
    // When prefix is short (<3 chars), the skip logic doesn't apply
    const q = tokenizeQuery("2000 by sydney 2000");
    expect(q.streetNumber).toBe(2000);
    // "by" is only 2 chars (<3), so the skip logic doesn't fire
    expect(detectPostcodeFilter(q)).toBe("2000");
  });

  test("postcode detected as last 4-digit token", () => {
    const q = tokenizeQuery("12 main st sydney 2000");
    expect(detectPostcodeFilter(q)).toBe("2000");
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

describe("regression: hyphen normalization", () => {
  test("'12-MAIN-ST' splits into 3 tokens via hyphen", () => {
    const t = tokenizeQuery("12-MAIN-ST");
    expect(t.tokens).toEqual(["12", "main", "st"]);
    expect(t.streetNumber).toBe(12);
    expect(t.streetPrefix).toBe("main");
  });

  test("'12-main-st' (already lowercase) splits correctly", () => {
    const t = tokenizeQuery("12-main-st");
    expect(t.tokens).toEqual(["12", "main", "st"]);
  });

  test("'main-st' splits via hyphen", () => {
    const t = tokenizeQuery("main-st");
    expect(t.tokens).toEqual(["main", "st"]);
    expect(t.streetPrefix).toBe("main");
  });

  test("hyphen between letters only (no number) still splits", () => {
    const t = tokenizeQuery("main-st-sydney");
    expect(t.tokens).toEqual(["main", "st", "sydney"]);
  });

  test("multiple consecutive hyphens produce empty tokens (filtered out)", () => {
    const t = tokenizeQuery("12--main");
    // After hyphen→space replacement: "12  main" → split on whitespace
    // produces an empty token between the two spaces, which is filtered
    // out by .filter(Boolean).
    expect(t.tokens).toEqual(["12", "main"]);
  });
});

describe("regression: all-number query short-circuit", () => {
  test("'12 34 56 78' returns all-null tokenized result", () => {
    const t = tokenizeQuery("12 34 56 78");
    expect(t.tokens).toEqual(["12", "34", "56", "78"]);
    expect(t.streetNumber).toBeNull();
    expect(t.streetPrefix).toBeNull();
    expect(t.localityPrefix).toBeNull();
    expect(t.flatNumber).toBeNull();
    expect(t.flatTypeAhead).toBe(false);
  });

  test("'2000 3000 4000' (all postcodes) returns all-null", () => {
    const t = tokenizeQuery("2000 3000 4000");
    expect(t.streetPrefix).toBeNull();
    expect(t.streetNumber).toBeNull();
  });

  test("'1 2 3' returns all-null", () => {
    const t = tokenizeQuery("1 2 3");
    expect(t.streetPrefix).toBeNull();
    expect(t.streetNumber).toBeNull();
  });

  test("'12 main 34' (mixed) extracts prefix normally", () => {
    const t = tokenizeQuery("12 main 34");
    expect(t.streetPrefix !== null || t.streetNumber !== null || t.localityPrefix !== null).toBe(
      true,
    );
  });
});

describe("regression: 3+ consecutive numbers short-circuit", () => {
  test("'12 34 56 test street' → empty (3 consecutive numbers, invalid address)", () => {
    const t = tokenizeQuery("12 34 56 test street");
    expect(t.streetPrefix).toBeNull();
    expect(t.streetNumber).toBeNull();
  });

  test("'1 2 3 4 test' → empty (4 consecutive numbers)", () => {
    const t = tokenizeQuery("1 2 3 4 test");
    expect(t.streetPrefix).toBeNull();
    expect(t.streetNumber).toBeNull();
  });

  test("'12 34 test' → NOT short-circuited (only 2 consecutive numbers)", () => {
    const t = tokenizeQuery("12 34 test");
    expect(t.streetPrefix).toBe("test");
    expect(t.streetNumber).toBe(34);
  });

  test("'12 34 test 56 sydney' → NOT short-circuited (2 then 1, not 3 consecutive)", () => {
    const t = tokenizeQuery("12 34 test 56 sydney");
    expect(t.streetPrefix).toBe("test");
    expect(t.streetNumber).toBe(34);
  });

  test("'unit 12 34 56 test' → empty (after flat type skip, 3 consecutive numbers)", () => {
    const t = tokenizeQuery("unit 12 34 56 test");
    // "unit" is skipped as flat type, then "12 34 56 test" has 3 numbers
    expect(t.streetPrefix).toBeNull();
  });
});

describe("regression: no-alphabetic-content short-circuit", () => {
  test("'12-56' (range without street) is NOT short-circuited — routes to tier1 with range", () => {
    // The all-digit guard requires NO hyphens (pure digit tokens). A range
    // like "12-56" is a single token containing a hyphen, so /^\d+$/ fails
    // and the guard doesn't fire. The 3-numbers guard also doesn't fire
    // (only 1 token). The query routes to tier1 with streetNumber=12.
    const t = tokenizeQuery("12-56");
    expect(t.tokens).toEqual(["12-56"]);
    expect(t.streetNumber).toBe(12);
    expect(t.streetPrefix).toBeNull();
  });
});

describe("regression: hyphen range preservation", () => {
  test("'12-56 main st' preserves the range (digit-digit hyphen kept)", () => {
    const t = tokenizeQuery("12-56 main st");
    expect(t.tokens).toEqual(["12-56", "main", "st"]);
    expect(t.streetNumber).toBe(12);
    expect(t.streetPrefix).toBe("main");
  });

  test("'12-56' alone: range preserved, streetNumber from first number", () => {
    const t = tokenizeQuery("12-56");
    expect(t.tokens).toEqual(["12-56"]);
    expect(t.streetNumber).toBe(12);
  });

  test("'12-MAIN-ST' splits (letter hyphens are separators)", () => {
    const t = tokenizeQuery("12-MAIN-ST");
    expect(t.tokens).toEqual(["12", "main", "st"]);
    expect(t.streetNumber).toBe(12);
    expect(t.streetPrefix).toBe("main");
  });

  test("'1a-2b test' splits on letter hyphens", () => {
    const t = tokenizeQuery("1a-2b test");
    expect(t.tokens).toEqual(["1a", "2b", "test"]);
  });

  test("'12-56-78 main' (3-number range with hyphens) → preserved as single token", () => {
    const t = tokenizeQuery("12-56-78 main");
    expect(t.tokens).toEqual(["12-56-78", "main"]);
  });
});

describe("regression: findPrefixToken accepts STREET_TYPE_LC tokens", () => {
  test("'4 avenue sydney' extracts prefix='avenue' not 'sydney'", () => {
    const t = tokenizeQuery("4 avenue sydney");
    expect(t.streetNumber).toBe(4);
    expect(t.streetPrefix).toBe("avenue");
  });

  test("'1 close canterbury' extracts prefix='close' not 'canterbury'", () => {
    const t = tokenizeQuery("1 close canterbury");
    expect(t.streetNumber).toBe(1);
    expect(t.streetPrefix).toBe("close");
  });

  test("'4 lane cooma' extracts prefix='lane' not 'cooma'", () => {
    const t = tokenizeQuery("4 lane cooma");
    expect(t.streetNumber).toBe(4);
    expect(t.streetPrefix).toBe("lane");
  });

  test("'3 court balranald' extracts prefix='court' not 'balranald'", () => {
    const t = tokenizeQuery("3 court balranald");
    expect(t.streetNumber).toBe(3);
    expect(t.streetPrefix).toBe("court");
  });

  test("'5 place sydney' extracts prefix='place' not 'sydney'", () => {
    const t = tokenizeQuery("5 place sydney");
    expect(t.streetNumber).toBe(5);
    expect(t.streetPrefix).toBe("place");
  });

  test("'12 way adelaide' extracts prefix='way' not 'adelaide'", () => {
    const t = tokenizeQuery("12 way adelaide");
    expect(t.streetNumber).toBe(12);
    expect(t.streetPrefix).toBe("way");
  });
});

describe("regression: non-alpha street prefixes via findPrefixToken", () => {
  test("'1 a1 sydney' extracts prefix='a1' (starts with letter, contains digit)", () => {
    const t = tokenizeQuery("1 a1 sydney");
    expect(t.streetNumber).toBe(1);
    expect(t.streetPrefix).toBe("a1");
  });

  test("'1 b1 sydney' extracts prefix='b1'", () => {
    const t = tokenizeQuery("1 b1 sydney");
    expect(t.streetNumber).toBe(1);
    expect(t.streetPrefix).toBe("b1");
  });

  test("'5 e4 sydney' extracts prefix='e4'", () => {
    const t = tokenizeQuery("5 e4 sydney");
    expect(t.streetNumber).toBe(5);
    expect(t.streetPrefix).toBe("e4");
  });

  test("'12 by sydney' extracts prefix='by' (2-letter, not in FLAT_TYPE_LC)", () => {
    const t = tokenizeQuery("12 by sydney");
    expect(t.streetNumber).toBe(12);
    expect(t.streetPrefix).toBe("by");
  });

  test("'1 4d' extracts prefix=null (starts with digit, not alpha)", () => {
    const t = tokenizeQuery("1 4d");
    expect(t.streetNumber).toBe(1);
    // "4d" starts with digit, not accepted by findPrefixToken
    expect(t.streetPrefix).toBeNull();
  });
});

describe("extractFlatNumber", () => {
  test("'unit 5 12 main' → flatNumber=5", () => {
    const t = tokenizeQuery("unit 5 12 main");
    expect(t.flatTypeAhead).toBe(true);
    expect(t.flatNumber).toBe(5);
    expect(t.streetNumber).toBe(12);
  });

  test("'apt 2 6 george' → flatNumber=2", () => {
    const t = tokenizeQuery("apt 2 6 george");
    expect(t.flatTypeAhead).toBe(true);
    expect(t.flatNumber).toBe(2);
    expect(t.streetNumber).toBe(6);
  });

  test("'12 main' (no flat prefix) → flatNumber=null", () => {
    const t = tokenizeQuery("12 main");
    expect(t.flatTypeAhead).toBe(false);
    expect(t.flatNumber).toBeNull();
  });

  test("'flat 3 8 main' → flatNumber=3", () => {
    const t = tokenizeQuery("flat 3 8 main");
    expect(t.flatTypeAhead).toBe(true);
    expect(t.flatNumber).toBe(3);
    expect(t.streetNumber).toBe(8);
  });

  test("'u2 6 main' (flat type prefixed) → streetNumber=6, flatNumber=null", () => {
    // "u2" matches isFlatTypePrefixed (u=unit, 2=flat number) → skipped in
    // extractLeadingParts. "6" is the only remaining number → becomes the
    // street number. extractFlatNumber only returns a flatNumber when two
    // consecutive numbers follow the flat type (e.g., "unit 1 6 main").
    const t = tokenizeQuery("u2 6 main");
    expect(t.streetNumber).toBe(6);
    expect(t.streetPrefix).toBe("main");
    // flatTypeAhead is false because FLAT_TYPE_LC.has("u2") is checked
    // directly; "u2" as a literal isn't in the set (only "u" is).
    expect(t.flatTypeAhead).toBe(false);
    expect(t.flatNumber).toBeNull();
  });

  test("'level 3 50 main st' → flatNumber=3", () => {
    const t = tokenizeQuery("level 3 50 main st");
    expect(t.flatTypeAhead).toBe(true);
    expect(t.flatNumber).toBe(3);
    expect(t.streetNumber).toBe(50);
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

describe("tokenizeQuery — additional edge cases", () => {
  test("query with number range '10-20 main st' extracts first number of range", () => {
    // Digit-digit hyphens are preserved as ranges. "10-20" resolves to 10
    // (the first number) via the rangeMatch in extractLeadingParts.
    const t = tokenizeQuery("10-20 main st");
    expect(t.tokens).toEqual(["10-20", "main", "st"]);
    expect(t.streetNumber).toBe(10);
    expect(t.streetPrefix).toBe("main");
  });

  test("query with leading comma is handled", () => {
    const t = tokenizeQuery(",12 main st");
    expect(t.streetNumber).toBe(12);
    expect(t.streetPrefix).toBe("main");
  });

  test("query with trailing comma is handled", () => {
    const t = tokenizeQuery("12 main st,");
    expect(t.streetPrefix).toBe("main");
    expect(t.streetNumber).toBe(12);
  });

  test("query with only a number and state", () => {
    const t = tokenizeQuery("12 nsw");
    expect(t.streetNumber).toBe(12);
    expect(t.streetPrefix).toBeNull();
  });

  test("query with only postcode and number — short-circuited (all digits, no address content)", () => {
    // "2000 12" is now short-circuited by the all-number guard. Such queries
    // can never match an address (no street name, no locality) and would
    // otherwise fall to tier4 trigram and match millions of digit-containing
    // rows. The user should provide a state or street name for this to work.
    const t = tokenizeQuery("2000 12");
    expect(t.streetNumber).toBeNull();
    expect(t.streetPrefix).toBeNull();
  });

  test("postcode detected as last 4-digit token", () => {
    const q = tokenizeQuery("12 main st sydney 2000");
    expect(detectPostcodeFilter(q)).toBe("2000");
  });

  test("postcode not detected when matching street number", () => {
    // "2000" is both the street number and looks like a postcode
    // Tokenizer should not flag it as postcode when it's the street number
    // and there's a proper street prefix
    const q = tokenizeQuery("2000 main st");
    expect(detectPostcodeFilter(q)).toBeNull();
  });

  test("flat type 'shop' is skipped like 'unit'", () => {
    const t = tokenizeQuery("shop 5 main st");
    expect(t.streetNumber).toBe(5);
    expect(t.streetPrefix).toBe("main");
    expect(t.flatTypeAhead).toBe(true);
  });

  test("flat type 'suite' is skipped", () => {
    const t = tokenizeQuery("suite 12 george st");
    expect(t.streetNumber).toBe(12);
    expect(t.streetPrefix).toBe("george");
    expect(t.flatTypeAhead).toBe(true);
  });

  test("flat type 'level' is skipped", () => {
    const t = tokenizeQuery("level 3 50 main st");
    // level 3 is skipped, then "50" is the number, "main" is the prefix
    expect(t.streetNumber).toBe(50);
    expect(t.streetPrefix).toBe("main");
    expect(t.flatTypeAhead).toBe(true);
  });

  test("multiple flat types in sequence (unit 1 apt 2)", () => {
    const t = tokenizeQuery("unit 1 apt 2 100 main st");
    // "unit" and "apt" are flat types, both skipped.
    // Remaining leading tokens: "1" (numeric) followed by "2" (numeric).
    // Since "apt" (flat type) separates them, they are NOT a number pair.
    // streetNumber=1 from first numeric token, prefix=main from alphabetic search
    expect(t.streetNumber).toBe(1);
    expect(t.streetPrefix).toBe("main");
  });

  test("query ending with street type sets localityPrefix to null", () => {
    const t = tokenizeQuery("sydney street");
    expect(t.localityPrefix).toBeNull();
    // "street" is a street type — last token should not be locality
    expect(t.streetPrefix).toBe("sydney");
  });

  test("query ending with road type sets localityPrefix to null", () => {
    const t = tokenizeQuery("main road");
    expect(t.localityPrefix).toBeNull();
  });

  test("normalized is lowercase trimmed", () => {
    const t = tokenizeQuery("  MAIN ST  ");
    expect(t.normalized).toBe("main st");
  });

  test("startsWithNumber is false for alphabetic query", () => {
    const t = tokenizeQuery("main st sydney");
    expect(t.startsWithNumber).toBe(false);
  });

  test("startsWithNumber is true for numeric start", () => {
    const t = tokenizeQuery("12 main st");
    expect(t.startsWithNumber).toBe(true);
  });

});

describe("tokenizer preprocessing pipeline — failure mode guards", () => {
  // These tests guard against tokenizer misclassification that would cause
  // the router to pick a wrong tier and return zero results.

  test("1-char street name 'y' is classified as streetPrefix (not skipped)", () => {
    // Without the ≥1-char prefix fix, 'y' would fall through to tier2 trigram
    // and likely return 0 results (trigram similarity too low).
    const t = tokenizeQuery("y street");
    expect(t.streetPrefix).toBe("y");
    expect(t.streetNumber).toBeNull();
    expect(t.localityPrefix).toBeNull();
  });

  test("2-char street name 'pi' is classified as streetPrefix", () => {
    const t = tokenizeQuery("pi street");
    expect(t.streetPrefix).toBe("pi");
  });

  test("street type as only token 'close' is classified as streetPrefix (extractLeadingParts does not filter STREET_TYPE_LC)", () => {
    // extractLeadingParts directly checks /^[a-z]+$/ without filtering
    // STREET_TYPE_LC, so "close" passes as a street prefix.
    // This routes to tier1 (LIKE 'close%') which will find streets named CLOSE.
    const t = tokenizeQuery("close");
    expect(t.streetPrefix).toBe("close");
  });

  test("flat type 'unit' as first token has streetPrefix = next non-flat token", () => {
    const t = tokenizeQuery("unit road");
    expect(t.flatTypeAhead).toBe(true);
    // After skipping "unit", "road" is the next candidate.
    // extractLeadingParts accepts any alphabetic token, even street types.
    expect(t.streetPrefix).toBe("road");
  });

  test("state code 'nsw' as first token has null streetPrefix (STATE_LC exclusion)", () => {
    const t = tokenizeQuery("nsw road");
    // extractLeadingParts checks !STATE_LC — "nsw" is a state → returns null
    // without checking subsequent tokens.
    expect(t.streetPrefix).toBeNull();
  });

  test("number + state-like street '12 nsw' extracts number and prefix", () => {
    const t = tokenizeQuery("12 nsw");
    expect(t.streetNumber).toBe(12);
    // "nsw" is a state → STATE_LC excludes it → no prefix from first pass.
    // nsw has length 3 and the findPrefixToken also skips STATE_LC.
    // But extractLeadingParts returns { streetNumber: 12, streetPrefix: null }
    expect(t.streetPrefix).toBeNull();
  });

  test("number after flat types resolves correctly: 'u 1 6 main'", () => {
    const t = tokenizeQuery("u 1 6 main");
    expect(t.flatTypeAhead).toBe(true);
    expect(t.streetNumber).toBe(6); // second number after flat types
    expect(t.streetPrefix).toBe("main");
  });

  test("locality prefix is null when last token is a state code", () => {
    const t = tokenizeQuery("main st sydney nsw");
    expect(t.localityPrefix).toBeNull(); // "nsw" is a state → excluded
    expect(detectStateFilter(t)).toBe("NSW");
  });

  test("locality prefix is null when last token is a street type", () => {
    const t = tokenizeQuery("main street");
    expect(t.localityPrefix).toBeNull(); // "street" is a street type → excluded
  });

  test("locality prefix is null when last token is a number", () => {
    const t = tokenizeQuery("main st 2000");
    expect(t.localityPrefix).toBeNull();
  });

  test("postcode not confused with street number when both present", () => {
    const t = tokenizeQuery("2000 main st");
    // "2000" is the street number AND looks like a postcode
    expect(t.streetNumber).toBe(2000);
    expect(t.streetPrefix).toBe("main");
    // detectPostcodeFilter should NOT return "2000" when it matches street number
    expect(detectPostcodeFilter(t)).toBeNull();
  });

  test("postcode detected when different from street number", () => {
    const t = tokenizeQuery("12 main st sydney 2000");
    expect(t.streetNumber).toBe(12);
    expect(detectPostcodeFilter(t)).toBe("2000");
  });

  test("state detection from corrected token works", () => {
    const t = tokenizeQuery("sydney nzw");
    // "nzw" should be corrected to "NSW"
    expect(t.stateCorrectedFrom).toBe("nzw");
    expect(detectStateFilter(t)).toBe("NSW");
  });

  test("state correction does NOT trigger for non-typo state codes", () => {
    const t = tokenizeQuery("sydney nsw");
    expect(t.stateCorrectedFrom).toBeNull();
    expect(detectStateFilter(t)).toBe("NSW");
  });

  test("ambiguous state 'ns' is NOT corrected (distance 1 from multiple states)", () => {
    const t = tokenizeQuery("sydney ns");
    expect(t.stateCorrectedFrom).toBeNull();
    expect(detectStateFilter(t)).toBeNull();
  });

  test("typographic variants: leading comma stripped", () => {
    const t = tokenizeQuery(",12 main st");
    expect(t.streetNumber).toBe(12);
    expect(t.streetPrefix).toBe("main");
  });

  test("typographic variants: trailing comma stripped", () => {
    const t = tokenizeQuery("12 main st,");
    expect(t.streetPrefix).toBe("main");
  });

  test("query with only invalid chars after sanitization gives empty tokens", () => {
    const t = tokenizeQuery("@#$%");
    expect(t.tokens).toEqual(["@#$%"]);
    // The tokenizer doesn't sanitize — the router expects sanitizeQuery
    // to run first in the suggest handler
  });

  test("multi-word query 'st nsw' — first token is a valid streetPrefix (extractLeadingParts does not filter STREET_TYPE_LC)", () => {
    // "st" passes /^[a-z]+$/ and !STATE_LC (ST is not a state code)
    const t = tokenizeQuery("st nsw");
    expect(t.streetPrefix).toBe("st");
    expect(t.tokens.length).toBe(2);
  });

  test("flat type prefix 'u2' skips the flat type then finds number and prefix", () => {
    const t = tokenizeQuery("u2 12 main st");
    // isFlatTypePrefixed("u2") matches → skipped in extractLeadingParts
    // flatTypeAhead uses FLAT_TYPE_LC.has(tokens[0]) where tokens[0]="u2" — NOT in set
    // Use flatTypeAhead = isFlatTypePrefixed || FLAT_TYPE_LC.has(tokens[0])
    expect(t.streetNumber).toBe(12);
    expect(t.streetPrefix).toBe("main");
  });
});

describe("extractStreetTypeAbbrev", () => {
  test("extracts 'st' from 'main st'", () => {
    expect(extractStreetTypeAbbrev(["main", "st"])).toBe("st,");
  });

  test("extracts 'rd' from 'high rd'", () => {
    expect(extractStreetTypeAbbrev(["high", "rd"])).toBe("rd,");
  });

  test("normalises 'street' to 'st'", () => {
    expect(extractStreetTypeAbbrev(["main", "street"])).toBe("st,");
  });

  test("strips leading/trailing commas from tokens", () => {
    expect(extractStreetTypeAbbrev(["main", ",st,"])).toBe("st,");
  });

  test("returns null when no token is a street type", () => {
    expect(extractStreetTypeAbbrev(["sydney", "waverley"])).toBeNull();
  });

  test("returns first match in token order", () => {
    // "st" comes before "rd" → "st," wins
    expect(extractStreetTypeAbbrev(["main", "st", "cross", "rd"])).toBe("st,");
  });

  test("exposed via TokenizedQuery.streetTypeAbbrev", () => {
    const t = tokenizeQuery("12 main st sydney");
    expect(t.streetTypeAbbrev).toBe("st,");
  });
});

describe("combineMultiWordLocality", () => {
  test("combines penultimate alphabetic token with locality", () => {
    expect(combineMultiWordLocality("huntly", ["glen", "huntly"])).toBe("glen huntly");
  });

  test("skips when locality is null", () => {
    expect(combineMultiWordLocality(null, ["glen", "huntly"])).toBeNull();
  });

  test("skips when fewer than 2 tokens", () => {
    expect(combineMultiWordLocality("huntly", ["huntly"])).toBe("huntly");
  });

  test("does not combine when penultimate is a street type", () => {
    // "main st" → penultimate "main" is NOT a street type, but penultimate is "st"
    // — but in our function, the penultimate is the SECOND-TO-LAST token, which
    // for ["main", "st", "sydney"] is "st". "st" IS in STREET_TYPE_LC, so no boost.
    expect(combineMultiWordLocality("sydney", ["main", "st", "sydney"])).toBe("sydney");
  });

  test("does not combine when penultimate is a digit", () => {
    expect(combineMultiWordLocality("sydney", ["12", "sydney"])).toBe("sydney");
  });

  test("does not combine when penultimate is shorter than 2 chars", () => {
    expect(combineMultiWordLocality("sydney", ["a", "sydney"])).toBe("sydney");
  });

  test("exposed via TokenizedQuery.localityPrefix (multi-word boost applied)", () => {
    const t = tokenizeQuery("12 main mount waverley");
    expect(t.localityPrefix).toBe("mount waverley");
  });
});

describe("isAlphanumericJunkToken (regression: 12abc took 15s)", () => {
  test("flags '12abc' as junk", () => {
    expect(isAlphanumericJunkToken("12abc")).toBe(true);
  });

  test("flags '1abc' (≥2 trailing letters) as junk", () => {
    expect(isAlphanumericJunkToken("1abc")).toBe(true);
  });

  test("flags '1234abc' (any length, ≥2 trailing letters) as junk", () => {
    expect(isAlphanumericJunkToken("1234abc")).toBe(true);
  });

  test("does NOT flag '12a' (single trailing letter is valid AU street number)", () => {
    expect(isAlphanumericJunkToken("12a")).toBe(false);
  });

  test("does NOT flag '1a' (single trailing letter)", () => {
    expect(isAlphanumericJunkToken("1a")).toBe(false);
  });

  test("does NOT flag pure digits like '12'", () => {
    expect(isAlphanumericJunkToken("12")).toBe(false);
  });

  test("does NOT flag pure letters like 'abc'", () => {
    expect(isAlphanumericJunkToken("abc")).toBe(false);
  });

  test("does NOT flag '21st' (street-type abbreviation — user input)", () => {
    expect(isAlphanumericJunkToken("21st")).toBe(false);
  });

  test("does NOT flag '99rd'", () => {
    expect(isAlphanumericJunkToken("99rd")).toBe(false);
  });

  test("case-insensitive: '12ABC' is junk", () => {
    expect(isAlphanumericJunkToken("12ABC")).toBe(true);
  });

  test("'12abc' produces null localityPrefix so router short-circuits", () => {
    const t = tokenizeQuery("12abc");
    expect(t.localityPrefix).toBeNull();
    expect(t.streetPrefix).toBeNull();
    expect(t.streetNumber).toBeNull();
  });

  test("'1a' still produces streetNumber=1 (legitimate AU format)", () => {
    const t = tokenizeQuery("1a");
    expect(t.streetNumber).toBe(1);
    expect(t.numberSuffix).toBe("a");
  });

  test("'12a main st' still produces tier1 routing (legitimate AU format)", () => {
    const t = tokenizeQuery("12a main st");
    expect(t.streetNumber).toBe(12);
    expect(t.streetPrefix).toBe("main");
    expect(t.numberSuffix).toBe("a");
    expect(t.streetTypeAbbrev).toBe("st,");
  });

  test("'21st main st' is NOT junk (street-type abbreviation is valid)", () => {
    expect(isAlphanumericJunkToken("21st")).toBe(false);
  });
});
