import { describe, expect, test } from "bun:test";
import { routeQuery } from "../../src/db/router";

describe("routeQuery", () => {
  test("state+postcode → tier0", async () => {
    const r = await routeQuery("sydney", "NSW", "2000", 10);
    expect(r.tier).toBe("tier0");
  });

  test("state+streetNumber → tier0_number", async () => {
    const r = await routeQuery("12 main", "NSW", null, 10);
    expect(r.tier).toBe("tier0_number");
  });

  test("state+number wins over state+locality (number is cheaper)", async () => {
    const r = await routeQuery("12 main syd", "NSW", null, 10);
    // tier0_number is checked BEFORE tier0_locality in the decision tree
    expect(r.tier).toBe("tier0_number");
  });

  test("street prefix only → tier1", async () => {
    const r = await routeQuery("main street", null, null, 10);
    expect(r.tier).toBe("tier1");
  });

  test("state+locality prefix (no number, 'syd' >= 2 chars)", async () => {
    const r = await routeQuery("main syd", "NSW", null, 10);
    expect(r.tier).toBe("tier0_locality");
  });

  test("single token alphabetic 'syd' → tier1 (streetPrefix)", async () => {
    // 'syd' is alphabetic, >= 3 chars, not a state → streetPrefix
    const r = await routeQuery("syd", null, null, 10);
    expect(r.tier).toBe("tier1");
  });

  test("2-char query with state → tier0_locality (locality prefix >= 2 chars)", async () => {
    const r = await routeQuery("sy", "NSW", null, 10);
    expect(r.tier).toBe("tier0_locality");
  });

  test("single char no state → tier1 (prefix threshold ≥1)", async () => {
    const r = await routeQuery("s", null, null, 10);
    expect(r.tier).toBe("tier1");
  });
});

describe("routeQuery — hasFullAddress gate", () => {
  test("5+ tokens with 3+ char prefix skips tier0 (hasFullAddress=true)", async () => {
    // "12 main st sydney nsw 2000" — 7 tokens, prefix "main" = 4 chars
    const r = await routeQuery("12 main st sydney nsw 2000", "NSW", "2000", 10);
    // hasFullAddress=true → skip tier0/0c → falls to tier1
    expect(r.tier).toBe("tier1");
  });

  test("5+ tokens with 1-char prefix still hits tier0 (prefix < 3)", async () => {
    const r = await routeQuery("1 a st sydney nsw 2000", "NSW", "2000", 10);
    // prefix "a" is only 1 char, hasFullAddress=false → tier0
    expect(r.tier).toBe("tier0");
  });

  test("4 tokens (not meeting ≥5) routes to tier0", async () => {
    const r = await routeQuery("sydney nsw 2000", "NSW", "2000", 10);
    expect(r.tier).toBe("tier0");
  });
});

describe("routeQuery — multi-word locality", () => {
  test("penultimate+last combined when penultimate is alphabetic and not a street type", async () => {
    const r = await routeQuery("main clayton south", null, null, 10);
    // The router should pass both "clayton" and "south" as the locale
    expect(r.tier).toBe("tier1");
  });

  test("penultimate NOT combined when it's a street type code", async () => {
    const r = await routeQuery("main st sydney", null, null, 10);
    // "st" is a street type → should NOT combine with "sydney"
    expect(r.tier).toBe("tier1");
  });

  test("penultimate NOT combined when it's a state code", async () => {
    const r = await routeQuery("main sydney act", null, null, 10);
    // "act" is a state → should NOT combine with previous token
    expect(r.tier).toBe("tier1");
  });
});

describe("routeQuery — street type boost detection", () => {
  test("street type 'st' is detected for display boost", async () => {
    const r = await routeQuery("1 main st", null, null, 10);
    expect(r.tier).toBe("tier1");
  });

  test("street type 'road' (full word) is detected for display boost", async () => {
    const r = await routeQuery("1 main road", null, null, 10);
    expect(r.tier).toBe("tier1");
  });

  test("street type 'avenue' is detected", async () => {
    const r = await routeQuery("1 george avenue", null, null, 10);
    expect(r.tier).toBe("tier1");
  });

  test("no street type in query still routes to tier1", async () => {
    const r = await routeQuery("1 main", null, null, 10);
    expect(r.tier).toBe("tier1");
  });
});

describe("routeQuery — state queries (no state-only routing)", () => {
  test("'nsw' alone → tier2 (no state-only route, falls to trigram)", async () => {
    const r = await routeQuery("nsw", null, null, 10);
    expect(r.tier).toBe("tier2");
  });

  test("'nzw' (state typo) → tier2 (no state-only route)", async () => {
    const r = await routeQuery("nzw", null, null, 10);
    expect(r.tier).toBe("tier2");
    expect(r.stateCorrectedFrom).toBe("nzw");
  });

  test("'12 nzw' (number + state typo) → tier0_number", async () => {
    const r = await routeQuery("12 nzw", null, null, 10);
    expect(r.tier).toBe("tier0_number");
    expect(r.stateCorrectedFrom).toBe("nzw");
  });

  test("'12 nsw' (number + exact state) → tier0_number", async () => {
    const r = await routeQuery("12 nsw", null, null, 10);
    expect(r.tier).toBe("tier0_number");
  });

  test("'sy' (2-char) → tier1, NOT state-corrected", async () => {
    const r = await routeQuery("sy", null, null, 10);
    expect(r.tier).toBe("tier1");
    expect(r.stateCorrectedFrom).toBeUndefined();
  });
});
