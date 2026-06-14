import { describe, expect, test } from "bun:test";
import { computeScore } from "../../src/search/scorer";

describe("computeScore", () => {
  test("high similarity + high confidence", () => {
    const score = computeScore(1.0, 1.0);
    expect(score).toBeCloseTo(1.693, 2);
  });

  test("high similarity + low confidence", () => {
    const score = computeScore(1.0, 0.0);
    expect(score).toBeCloseTo(1.0, 2);
  });

  test("low similarity + high confidence", () => {
    const score = computeScore(0.3, 1.0);
    expect(score).toBeCloseTo(0.508, 2);
  });

  test("zero similarity", () => {
    const score = computeScore(0.0, 1.0);
    expect(score).toBe(0);
  });

  test("mid values", () => {
    const score = computeScore(0.7, 0.5);
    const expected = 0.7 * (1 + Math.log(1.5));
    expect(score).toBeCloseTo(expected, 4);
  });
});
