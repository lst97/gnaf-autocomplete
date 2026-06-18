import { describe, expect, test } from "bun:test";
import { sanitizeQuery, isValidAddressQuery } from "../../src/api/suggest";
import { isAlphanumericJunkToken } from "../../src/search/tokenizer";

// Parse-and-clamp helpers mirroring the logic in suggestRoute.
// These test the regression that parseInt("0") || default returns the
// default 10 for limit=0 instead of clamping to 1.
function parseLimit(s: string | undefined): number {
  const parsed = Number.parseInt(s ?? "", 10);
  return Number.isNaN(parsed) ? 10 : Math.min(Math.max(parsed, 1), 50);
}
function parseOffset(s: string | undefined): number {
  const parsed = Number.parseInt(s ?? "", 10);
  return Number.isNaN(parsed) ? 0 : Math.min(Math.max(parsed, 0), 1000);
}

describe("sanitizeQuery", () => {
  test("preserves normal address text", () => {
    expect(sanitizeQuery("12 main st sydney")).toBe("12 main st sydney");
  });

  test("removes angle brackets and parens", () => {
    const result = sanitizeQuery("12 main st <script>alert('xss')</script>");
    expect(result).not.toContain("<");
    expect(result).not.toContain(">");
    expect(result).not.toContain("(");
    expect(result).not.toContain(")");
  });

  test("removes semicolons (SQL injection)", () => {
    const result = sanitizeQuery("sydney'; DROP TABLE addresses;--");
    expect(result).not.toContain(";");
  });

  test("preserves apostrophes in place names", () => {
    expect(sanitizeQuery("a'beckett street sydney")).toBe("a'beckett street sydney");
  });

  test("preserves hyphens in street names", () => {
    expect(sanitizeQuery("bong-bong street bowral")).toBe("bong-bong street bowral");
  });

  test("preserves commas and periods", () => {
    expect(sanitizeQuery("st. mary's road, nsw")).toBe("st. mary's road, nsw");
  });

  test("trims whitespace", () => {
    expect(sanitizeQuery("  sydney  ")).toBe("sydney");
  });

  test("handles empty input", () => {
    expect(sanitizeQuery("")).toBe("");
  });

  test("handles path traversal (dots and slashes are allowed)", () => {
    const result = sanitizeQuery("../../../etc/passwd");
    // Dots and slashes are valid address characters, so they pass through
    expect(result).toBe("../../../etc/passwd");
  });

  test("preserves street numbers with letters", () => {
    expect(sanitizeQuery("3b queen st")).toBe("3b queen st");
  });

  // Additional edge cases
  test("removes backticks", () => {
    expect(sanitizeQuery("sydney`")).toBe("sydney");
  });

  test("removes double quotes", () => {
    expect(sanitizeQuery('sydney "drop" tables')).toBe("sydney drop tables");
  });

  test("removes at signs", () => {
    expect(sanitizeQuery("sydney@test")).toBe("sydneytest");
  });

  test("removes hash symbols", () => {
    expect(sanitizeQuery("sydney#test")).toBe("sydneytest");
  });

  test("removes exclamation marks", () => {
    expect(sanitizeQuery("sydney!main")).toBe("sydneymain");
  });

  test("preserves whitespace characters (\\n, \\t are \\s)", () => {
    // The regex allows \s, which includes \n and \t
    const result = sanitizeQuery("sydney\nmain\tst");
    expect(result).toBe("sydney\nmain\tst");
  });

  test("removes unicode control characters (\\u0000)", () => {
    const result = sanitizeQuery("sydney\u0000main\u001fst");
    expect(result).toBe("sydneymainst");
  });

  test("preserves forward slashes (used in flat/unit addresses)", () => {
    expect(sanitizeQuery("1/6 fortuna road")).toBe("1/6 fortuna road");
  });

  test("preserves multiple consecutive hyphens", () => {
    expect(sanitizeQuery("bong---bong road")).toBe("bong---bong road");
  });

  test("strips only invalid characters from mixed input", () => {
    const result = sanitizeQuery("12 main~st@sydney#nsw!2000");
    // ~, @, #, ! are removed; no spaces introduced between joined tokens
    expect(result).toBe("12 mainstsydneynsw2000");
  });

  test("preserves valid address with all allowed characters", () => {
    // Allowed: a-zA-Z0-9, space, hyphen, apostrophe, comma, period, forward slash
    const input = "12-a'beckett st., sydney/2000 nsw";
    expect(sanitizeQuery(input)).toBe(input);
  });

  test("handles query with only invalid characters", () => {
    // Allowed: a-zA-Z0-9, \s, -, ', comma, period, forward slash
    // Input has no hyphens
    expect(sanitizeQuery("~!@#$%^&*()_+=`{}[]|\\:;\"'<>?,./")).toBe("',./");
  });

  test("normalizes whitespace", () => {
    expect(sanitizeQuery("  sydney  2000  ")).toBe("sydney  2000");
  });

  test("removes null byte injection", () => {
    expect(sanitizeQuery("sydney\u0000main\u0000street")).toBe("sydneymainstreet");
  });
});

describe("isValidAddressQuery", () => {
  // ── Valid queries ──
  test("'sydney' — valid locality", () => {
    expect(isValidAddressQuery("sydney")).toBe(true);
  });

  test("'12 main st' — number + street + type", () => {
    expect(isValidAddressQuery("12 main st")).toBe(true);
  });

  test("'12-56 main st' — range + street (hyphens break digit sequence)", () => {
    expect(isValidAddressQuery("12-56 main st")).toBe(true);
  });

  test("'2000' — valid postcode (4 digits)", () => {
    expect(isValidAddressQuery("2000")).toBe(true);
  });

  test("'gresford' — single word street name", () => {
    expect(isValidAddressQuery("gresford")).toBe(true);
  });

  test("'1 a' — number + 1-letter street (valid rural road)", () => {
    expect(isValidAddressQuery("1 a")).toBe(true);
  });

  test("'12 a'beckett st' — apostrophe in street", () => {
    expect(isValidAddressQuery("12 a'beckett st")).toBe(true);
  });

  test("'unit 5 12 main' — flat pattern", () => {
    expect(isValidAddressQuery("unit 5 12 main")).toBe(true);
  });

  test("'12-56' — bare range without street", () => {
    expect(isValidAddressQuery("12-56")).toBe(true);
  });

  // ── Invalid queries ──
  test("'12 34 56 test street' — 3+ consecutive digits", () => {
    expect(isValidAddressQuery("12 34 56 test street")).toBe(false);
  });

  test("'12 34 56' — 3 all-digit tokens", () => {
    expect(isValidAddressQuery("12 34 56")).toBe(false);
  });

  test("'12 34 56 78' — 4 all-digit tokens", () => {
    expect(isValidAddressQuery("12 34 56 78")).toBe(false);
  });

  test("'unit 12 34 56 test' — flat + 3 consecutive numbers", () => {
    expect(isValidAddressQuery("unit 12 34 56 test")).toBe(false);
  });

  test("'asdfghjkl' — gibberish, no meaningful address content", () => {
    expect(isValidAddressQuery("asdfghjkl")).toBe(true); // has alpha, <3 digits
  });

  test("'@#$%' — no meaningful content (symbols only)", () => {
    expect(isValidAddressQuery("@#$%")).toBe(false);
  });

  test("'   ' — whitespace only", () => {
    expect(isValidAddressQuery("   ")).toBe(false);
  });

  test("'123456' — 6 consecutive digits, not a postcode", () => {
    expect(isValidAddressQuery("123456")).toBe(false);
  });

  test("'a' — single letter, below minimum meaningful threshold of 2", () => {
    expect(isValidAddressQuery("a")).toBe(false);
  });

  test("'ab' — two letters, meets meaningful threshold", () => {
    expect(isValidAddressQuery("ab")).toBe(true);
  });

  test("'nsw' — pure state code is rejected (not useful for autocomplete)", () => {
    expect(isValidAddressQuery("nsw")).toBe(false);
  });

  test("'VIC' — uppercase state code is rejected", () => {
    expect(isValidAddressQuery("VIC")).toBe(false);
  });

  test("'sydney nsw 2000' — state with context is still valid", () => {
    expect(isValidAddressQuery("sydney nsw 2000")).toBe(true);
  });

  test("'' — empty string", () => {
    expect(isValidAddressQuery("")).toBe(false);
  });

  // ── Regression: 12abc / 1abc / 12ABC took 15+ seconds via tier2 trigram ──
  test("'12abc' — alphanumeric junk is rejected (was 15s slow path)", () => {
    expect(isValidAddressQuery("12abc")).toBe(false);
  });

  test("'12ABC' — uppercase variant also rejected", () => {
    expect(isValidAddressQuery("12ABC")).toBe(false);
  });

  test("'1abc' — single-digit + 3-letter junk is rejected", () => {
    expect(isValidAddressQuery("1abc")).toBe(false);
  });

  test("'1234abc' — any length junk is rejected", () => {
    expect(isValidAddressQuery("1234abc")).toBe(false);
  });

  test("'12a' — single alphanumeric token REJECTED (was 14s tier2 slow path)", () => {
    expect(isValidAddressQuery("12a")).toBe(false);
  });

  test("'1a' — single alphanumeric token REJECTED (was tier2 slow path)", () => {
    expect(isValidAddressQuery("1a")).toBe(false);
  });

  test("'12abc sydney' — junk token anywhere in query rejects the whole query", () => {
    expect(isValidAddressQuery("12abc sydney")).toBe(false);
  });

  test("'sydney 12abc' — junk token at end also rejects", () => {
    expect(isValidAddressQuery("sydney 12abc")).toBe(false);
  });

  test("'21st' — single alphanumeric street-type token REJECTED (was tier2 slow path)", () => {
    expect(isValidAddressQuery("21st")).toBe(false);
  });

  test("'99rd' — single alphanumeric street-type token REJECTED (was tier2 slow path)", () => {
    expect(isValidAddressQuery("99rd")).toBe(false);
  });

  test("'12 main st' — legitimate AU address with street type passes", () => {
    expect(isValidAddressQuery("12 main st")).toBe(true);
  });

  test("'12a main st' — alphanumeric street number with letter suffix passes", () => {
    expect(isValidAddressQuery("12a main st")).toBe(true);
  });

  // ── Rule 7: single-token queries must be searchable on their own ──
  test("'12' — pure 2-digit number REJECTED (no postcode, no street)", () => {
    expect(isValidAddressQuery("12")).toBe(false);
  });

  test("'99' — pure 2-digit number REJECTED", () => {
    expect(isValidAddressQuery("99")).toBe(false);
  });

  test("'1' — single digit REJECTED", () => {
    expect(isValidAddressQuery("1")).toBe(false);
  });

  test("'200' — 3-digit partial postcode REJECTED (AU postcodes are 4 digits)", () => {
    expect(isValidAddressQuery("200")).toBe(false);
  });

  test("'2000' — 4-digit postcode is VALID", () => {
    expect(isValidAddressQuery("2000")).toBe(true);
  });

  test("'0800' — 4-digit postcode with leading zero is VALID (NT)", () => {
    expect(isValidAddressQuery("0800")).toBe(true);
  });

  test("'12 sydney' — number + locality passes (multi-token, tier1 fast)", () => {
    expect(isValidAddressQuery("12 sydney")).toBe(true);
  });

  test("'12 nsw' — number + state passes (multi-token, tier0_number fast)", () => {
    expect(isValidAddressQuery("12 nsw")).toBe(true);
  });

  test("'12 main' — number + street passes (multi-token, tier1 fast)", () => {
    expect(isValidAddressQuery("12 main")).toBe(true);
  });

  test("'gresford' — alphabetic street name alone is VALID (single token)", () => {
    expect(isValidAddressQuery("gresford")).toBe(true);
  });

  test("'ab' — 2-letter alphabetic is VALID (single token)", () => {
    expect(isValidAddressQuery("ab")).toBe(true);
  });
});

describe("parseLimit (regression: limit=0 gave default 10)", () => {
  test("limit=0 clamps to 1", () => {
    expect(parseLimit("0")).toBe(1);
  });

  test("limit=10 passes through", () => {
    expect(parseLimit("10")).toBe(10);
  });

  test("limit=999 clamps to 50", () => {
    expect(parseLimit("999")).toBe(50);
  });

  test("limit=abc defaults to 10", () => {
    expect(parseLimit("abc")).toBe(10);
  });

  test("limit=(empty) defaults to 10", () => {
    expect(parseLimit(undefined)).toBe(10);
  });

  test("limit=1 passes through (minimum)", () => {
    expect(parseLimit("1")).toBe(1);
  });
});

describe("parseOffset (regression: offset=0 works correctly)", () => {
  test("offset=0 passes through", () => {
    expect(parseOffset("0")).toBe(0);
  });

  test("offset=50 passes through", () => {
    expect(parseOffset("50")).toBe(50);
  });

  test("offset=-5 clamps to 0", () => {
    expect(parseOffset("-5")).toBe(0);
  });

  test("offset=999999 clamps to 1000", () => {
    expect(parseOffset("999999")).toBe(1000);
  });

  test("offset=abc defaults to 0", () => {
    expect(parseOffset("abc")).toBe(0);
  });

  test("offset=(empty) defaults to 0", () => {
    expect(parseOffset(undefined)).toBe(0);
  });
});
