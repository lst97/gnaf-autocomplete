import { describe, expect, test } from "bun:test";
import {
  AppError,
  DatabaseError,
  ERROR_CODES,
  ValidationError,
} from "../../src/lib/errors";

describe("AppError", () => {
  test("creates with default values", () => {
    const err = new AppError("something went wrong");
    expect(err.message).toBe("something went wrong");
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe("INTERNAL_ERROR");
    expect(err.name).toBe("AppError");
  });

  test("creates with custom status code", () => {
    const err = new AppError("not found", 404);
    expect(err.statusCode).toBe(404);
  });

  test("creates with custom code", () => {
    const err = new AppError("bad request", 400, "BAD_REQUEST");
    expect(err.code).toBe("BAD_REQUEST");
  });

  test("is instanceof Error", () => {
    const err = new AppError("test");
    expect(err instanceof Error).toBe(true);
  });
});

describe("ValidationError", () => {
  test("creates with 400 status", () => {
    const err = new ValidationError("invalid input");
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.name).toBe("ValidationError");
    expect(err.message).toBe("invalid input");
  });
});

describe("DatabaseError", () => {
  test("creates with 500 status", () => {
    const err = new DatabaseError("connection failed");
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe("DATABASE_ERROR");
    expect(err.name).toBe("DatabaseError");
    expect(err.message).toBe("connection failed");
  });
});

describe("ERROR_CODES registry", () => {
  test("contains all required error codes", () => {
    expect(ERROR_CODES.VALIDATION_ERROR).toBe("VALIDATION_ERROR");
    expect(ERROR_CODES.DATABASE_ERROR).toBe("DATABASE_ERROR");
    expect(ERROR_CODES.INTERNAL_ERROR).toBe("INTERNAL_ERROR");
  });

  test("all error codes are uppercase snake_case", () => {
    for (const key of Object.keys(ERROR_CODES) as Array<keyof typeof ERROR_CODES>) {
      expect(ERROR_CODES[key]).toMatch(/^[A-Z][A-Z_]+$/);
    }
  });

  test("no duplicate values in ERROR_CODES", () => {
    const values = Object.values(ERROR_CODES);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  test("error subclasses use codes from the registry", () => {
    const ve = new ValidationError("test");
    const de = new DatabaseError("test");
    const ae = new AppError("test");
    expect(Object.values(ERROR_CODES)).toContain(ve.code);
    expect(Object.values(ERROR_CODES)).toContain(de.code);
    expect(Object.values(ERROR_CODES)).toContain(ae.code);
  });

  test("subclass constructors do not accept custom code (they hardcode it)", () => {
    // @ts-expect-error - subclass constructors only accept message
    const ve = new ValidationError("test", 400, "CUSTOM_CODE");
    expect(ve.code).toBe("VALIDATION_ERROR"); // not "CUSTOM_CODE"
  });
});
