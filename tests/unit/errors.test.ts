import { describe, expect, test } from "bun:test";
import { AppError, DatabaseError, ValidationError } from "../../src/lib/errors";

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
