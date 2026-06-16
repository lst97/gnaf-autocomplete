import { afterAll, describe, expect, test } from "bun:test";
import { logger } from "../../src/lib/logger";

describe("logger", () => {
  test("is a pino logger instance", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.trace).toBe("function");
    expect(typeof logger.fatal).toBe("function");
  });

  test("has valid log level set", () => {
    // Should be one of: trace, debug, info, warn, error, fatal
    expect(["trace", "debug", "info", "warn", "error", "fatal"]).toContain(
      logger.level,
    );
  });

  test("logger.info can be called without throwing", () => {
    expect(() => logger.info("test message")).not.toThrow();
  });

  test("logger.info supports structured object format", () => {
    expect(() => logger.info({ key: "value" }, "structured message")).not.toThrow();
  });

  test("logger.error can be called without throwing", () => {
    expect(() => logger.error(new Error("test error"), "error message")).not.toThrow();
  });

  test("logger.warn supports message only", () => {
    expect(() => logger.warn("warning message")).not.toThrow();
  });

  test("logger.debug supports message only", () => {
    expect(() => logger.debug("debug message")).not.toThrow();
  });

  test("logger is a singleton (same instance on re-import)", async () => {
    const { logger: logger2 } = await import("../../src/lib/logger");
    expect(logger).toBe(logger2);
  });
});
