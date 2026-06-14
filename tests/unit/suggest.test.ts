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
});
