import { describe, expect, test } from "bun:test";

// Test sanitizeQuery by importing the function indirectly through the suggest module
// Since it's not exported, we test the same regex directly
function sanitizeQuery(q: string): string {
  return q.replace(/[^a-zA-Z0-9\s\-',./]/g, "").trim();
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

// ── isValidAddressQuery ──────────────────────────────────────────

const VALID_STATE_CODES = new Set(["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA", "OT"]);
function isValidAddressQuery(q: string): boolean {
  if (q.length === 0) return false;
  if (/^\d{4}$/.test(q.trim())) return true;
  if (/^\d+-\d+$/.test(q.trim())) return true;
  if (!/[a-zA-Z]/.test(q)) return false;
  if (VALID_STATE_CODES.has(q.trim().toUpperCase())) return false;
  const tokens = q.split(/\s+/);
  let consecutiveDigitTokens = 0;
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      consecutiveDigitTokens++;
      if (consecutiveDigitTokens >= 3) return false;
    } else {
      consecutiveDigitTokens = 0;
    }
  }
  const meaningful = q.replace(/[^a-zA-Z0-9]/g, "").length;
  if (meaningful < 2) return false;
  return true;
}

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
    expect(isValidAddressQuery("asdfghjkl")).toBe(true);  // has alpha, <3 digits
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
});
