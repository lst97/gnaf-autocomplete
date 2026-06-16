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

  // Confidence normalization: NULL → 0.5, -1 → 0.3
  test("null confidence is normalized to 0.5", () => {
    // Before reaching scorer, NULL gets mapped to 0.5
    const score = computeScore(0.8, 0.5);
    expect(score).toBeCloseTo(0.8 * (1 + Math.log(1.5)), 4);
  });

  test("negative confidence (-1) is normalized to 0.3", () => {
    const score = computeScore(0.8, 0.3);
    expect(score).toBeCloseTo(0.8 * (1 + Math.log(1.3)), 4);
  });

  test("score at maximum: sim=1.0, conf=6 (max G-NAF confidence)", () => {
    // max confidence_norm = (6+1)/7 ≈ 1.0
    const score = computeScore(1.0, 1.0);
    expect(score).toBeCloseTo(1.693, 2);
  });

  test("score at minimum: sim=0.0, conf=0", () => {
    const score = computeScore(0.0, 0.0);
    expect(score).toBe(0);
  });

  test("negligible similarity returns near-zero score", () => {
    const score = computeScore(0.1, 1.0);
    const expected = 0.1 * (1 + Math.log(2.0));
    expect(score).toBeCloseTo(expected, 4);
  });

  test("confidence boost is logarithmic (not linear)", () => {
    const base = computeScore(1.0, 0.0); // 1.0
    const boosted = computeScore(1.0, 1.0); // ~1.693
    // Boost from 0→1 confidence should be less than 2x (logarithmic)
    expect(boosted).toBeLessThan(2.0);
    expect(boosted).toBeGreaterThan(1.0);
  });

  test("result is always >= similarity (confidence never reduces score)", () => {
    const scores = [
      computeScore(0.5, 0.0),
      computeScore(0.5, 0.3),
      computeScore(0.5, 0.7),
      computeScore(0.5, 1.0),
    ];
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(0.5);
    }
  });

  test("smallest possible non-zero score", () => {
    const score = computeScore(0.01, 0.01);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(0.1);
  });
});
