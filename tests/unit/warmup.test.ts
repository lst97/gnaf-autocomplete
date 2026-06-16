import { describe, expect, test } from "bun:test";
import { WARMUP_TASKS } from "../../src/sql/warmup";

describe("WARMUP_TASKS", () => {
  test("exports a non-empty array", () => {
    expect(Array.isArray(WARMUP_TASKS)).toBe(true);
    expect(WARMUP_TASKS.length).toBeGreaterThan(0);
  });

  test("each task has required fields", () => {
    for (const task of WARMUP_TASKS) {
      expect(task).toHaveProperty("label");
      expect(task).toHaveProperty("sql");
      expect(task).toHaveProperty("params");
    }
  });

  test("each label is valid", () => {
    const validLabels = ["tier0", "tier0b", "tier0c", "tier1", "postcode"];
    for (const task of WARMUP_TASKS) {
      expect(validLabels).toContain(task.label);
    }
  });

  test("each sql is a non-empty string", () => {
    for (const task of WARMUP_TASKS) {
      expect(typeof task.sql).toBe("string");
      expect(task.sql.length).toBeGreaterThan(0);
    }
  });

  test("each params is an array of strings or numbers", () => {
    for (const task of WARMUP_TASKS) {
      expect(Array.isArray(task.params)).toBe(true);
      for (const p of task.params) {
        expect(typeof p === "string" || typeof p === "number").toBe(true);
      }
    }
  });

  test("SQL statements reference $N parameters up to params.length", () => {
    for (const task of WARMUP_TASKS) {
      for (let i = 1; i <= task.params.length; i++) {
        expect(task.sql).toContain(`$${i}`);
      }
    }
  });

  test("has at least one task per tier label", () => {
    const labels = WARMUP_TASKS.map((t) => t.label);
    expect(labels.filter((l) => l === "tier0").length).toBeGreaterThanOrEqual(1);
    expect(labels.filter((l) => l === "tier0b").length).toBeGreaterThanOrEqual(1);
    expect(labels.filter((l) => l === "tier0c").length).toBeGreaterThanOrEqual(1);
    expect(labels.filter((l) => l === "tier1").length).toBeGreaterThanOrEqual(1);
    expect(labels.filter((l) => l === "postcode").length).toBeGreaterThanOrEqual(1);
  });

  test("covers all major cities in tier1 params", () => {
    const tier1Params = WARMUP_TASKS.filter((t) => t.label === "tier1")
      .flatMap((t) => t.params)
      .filter((p) => typeof p === "string");
    const cities = ["sydne", "main", "george", "queen", "collins", "perth", "brisbane", "adelaide", "hobart", "darwin", "canberra"];
    for (const city of cities) {
      expect(tier1Params).toContain(`${city}%`);
    }
  });

  test("no duplicate identical tasks", () => {
    const serialized = WARMUP_TASKS.map((t) => JSON.stringify(t));
    const unique = new Set(serialized);
    expect(unique.size).toBe(serialized.length);
  });
});
