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

  test("single char no state → tier2 trigram", async () => {
    const r = await routeQuery("s", null, null, 10);
    expect(r.tier).toBe("tier2");
  });
});
