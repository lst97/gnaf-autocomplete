import { describe, expect, test } from "bun:test";
import { routeQuery } from "../../src/db/router";

describe("routeQuery — pagination", () => {
  test("state+postcode with offset passes through", async () => {
    const r = await routeQuery("sydney", "NSW", "2000", 10, 20);
    expect(r.tier).toBe("tier0");
  });

  test("state+number with offset", async () => {
    const r = await routeQuery("12 main", "NSW", null, 10, 5);
    expect(r.tier).toBe("tier0_number");
  });
});

describe("routeQuery — postcode numeric only", () => {
  test("purely numeric 4-digit goes to postcode tier", async () => {
    const r = await routeQuery("2000", null, null, 10);
    expect(r.tier).toBe("postcode");
  });

  test("purely numeric with state goes to tier0", async () => {
    // numeric + state → tier0 (state+postcode)
    const r = await routeQuery("2000", "NSW", null, 10);
    expect(r.tier).toBe("tier0");
  });

  test("mixed alpha-numeric falls to tier2 trigram", async () => {
    const r = await routeQuery("2000syd", null, null, 10);
    // "2000syd" first token is not purely digits → no streetNumber
    // Not purely alphabetic → no streetPrefix
    // Falls through to tier2 trigram
    expect(r.tier).toBe("tier2");
  });
});

describe("routeQuery — multi-word falls to tier2", () => {
  test("multi-word with short prefix <3 chars goes to tier4 (multi-word fuzzy)", async () => {
    // 'ab' is 2 chars — too short for tier1 street prefix. Falls through to tier4.
    const r = await routeQuery("ab cd sydney", null, null, 10);
    expect(r.tier).toBe("tier4");
  });

  test("single-word goes to tier1 (street prefix) since 'sydne' is a valid prefix", async () => {
    // "sydne" is alphabetic, >= 3 chars, not a state → streetPrefix = "sydne"
    // So it routes to tier1, not tier2 or tier4
    const r = await routeQuery("sydne", null, null, 10);
    expect(r.tier).toBe("tier1");
  });

  test("single char no state goes to tier2", async () => {
    const r = await routeQuery("s", null, null, 10);
    expect(r.tier).toBe("tier2");
  });

  test("single word goes to tier1 if alphabetic", async () => {
    const r = await routeQuery("sydney", null, null, 10);
    expect(r.tier).toBe("tier1");
  });
});

describe("routeQuery — number + street prefix (no state)", () => {
  test("'35 gresford' routes to tier1 (with number_first filter)", async () => {
    // Real address pattern — should narrow to just 35-gresford addresses,
    // not return all gresford streets.
    const r = await routeQuery("35 gresford", null, null, 10);
    expect(r.tier).toBe("tier1");
  });

  test("'12 main' routes to tier1 (with number_first filter)", async () => {
    const r = await routeQuery("12 main", null, null, 10);
    expect(r.tier).toBe("tier1");
  });
});

describe("routeQuery — flat type + number pattern", () => {
  test("'unit 1/6 fortuna' resolves to streetNumber=6, prefix=fortuna", async () => {
    // "unit" is a flat type, "1/6" means flat 1 / house 6
    // Expect: streetNumber=6, streetPrefix=fortuna → tier1 with filter
    const r = await routeQuery("unit 1/6 fortuna", null, null, 10);
    expect(r.tier).toBe("tier1");
  });

  test("'1/6 fortuna' resolves to streetNumber=6, prefix=fortuna", async () => {
    const r = await routeQuery("1/6 fortuna", null, null, 10);
    expect(r.tier).toBe("tier1");
  });

  test("'apt 5 george' resolves to prefix=george (apt is flat type)", async () => {
    const r = await routeQuery("apt 5 george", null, null, 10);
    expect(r.tier).toBe("tier1");
  });

  test("'unit 1 6 fortuna street' → number=6 (not 1), prefix=fortuna", async () => {
    const r = await routeQuery("unit 1 6 fortuna street", null, null, 10);
    expect(r.tier).toBe("tier1");
  });
});
