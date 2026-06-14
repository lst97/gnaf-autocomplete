import { describe, expect, test } from "bun:test";
import { buildDisplay } from "../../src/search/formatter";

describe("buildDisplay — edge cases", () => {
  test("building name with no street number", () => {
    const display = buildDisplay({
      buildingName: "OPERA HOUSE",
      streetName: "BENNELONG",
      streetTypeCode: "POINT",
      localityName: "SYDNEY",
      stateAbbreviation: "NSW",
      postcode: "2000",
    });
    expect(display).toContain("OPERA HOUSE, BENNELONG POINT");
  });

  test("flat type code not in mapping uses raw code", () => {
    const display = buildDisplay({
      flatTypeCode: "ZZZ",
      flatNumber: 99,
      numberFirst: 1,
      streetName: "TEST",
      streetTypeCode: "STREET",
      localityName: "SYDNEY",
      stateAbbreviation: "NSW",
      postcode: "2000",
    });
    expect(display).toContain("ZZZ 99");
  });

  test("missing street number with street name", () => {
    const display = buildDisplay({
      streetName: "MAIN",
      streetTypeCode: "STREET",
      localityName: "SYDNEY",
      stateAbbreviation: "NSW",
      postcode: "2000",
    });
    expect(display).toBe("MAIN ST, SYDNEY NSW 2000");
  });

  test("lot number with building name", () => {
    const display = buildDisplay({
      buildingName: "OLD FARM",
      lotNumber: "5",
      streetName: "BACK",
      streetTypeCode: "ROAD",
      localityName: "BROKE",
      stateAbbreviation: "NSW",
      postcode: "2330",
    });
    expect(display).toContain("OLD FARM, Lot 5");
    expect(display).toContain("BACK RD");
  });

  test("suffix code appended", () => {
    const display = buildDisplay({
      numberFirst: 10,
      streetName: "MAIN",
      streetTypeCode: "STREET",
      streetSuffixCode: "N",
      localityName: "SYDNEY",
      stateAbbreviation: "NSW",
      postcode: "2000",
    });
    expect(display).toContain("MAIN ST N");
  });

  test("level type code is preserved (not always 'L')", () => {
    const display = buildDisplay({
      levelTypeCode: "G",
      levelNumber: 1,
      numberFirst: 1,
      streetName: "GROUND",
      streetTypeCode: "STREET",
      localityName: "SYDNEY",
      stateAbbreviation: "NSW",
      postcode: "2000",
    });
    expect(display).toContain("G 1");
  });

  test("flat with level and street number", () => {
    const display = buildDisplay({
      flatTypeCode: "APT",
      flatNumber: 5,
      levelTypeCode: "L",
      levelNumber: 3,
      numberFirst: 12,
      streetName: "HIGH",
      streetTypeCode: "STREET",
      localityName: "SYDNEY",
      stateAbbreviation: "NSW",
      postcode: "2000",
    });
    expect(display).toBe("APT 5, L 3, 12 HIGH ST, SYDNEY NSW 2000");
  });

  test("number range with prefix and suffix", () => {
    const display = buildDisplay({
      numberFirstPrefix: "A",
      numberFirst: 10,
      numberFirstSuffix: "B",
      numberLastPrefix: "C",
      numberLast: 20,
      numberLastSuffix: "D",
      streetName: "MAIN",
      streetTypeCode: "STREET",
      localityName: "SYDNEY",
      stateAbbreviation: "NSW",
      postcode: "2000",
    });
    expect(display).toBe("A10B-C20D MAIN ST, SYDNEY NSW 2000");
  });
});
