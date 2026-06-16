/**
 * Registered error codes. Each code maps to a specific error scenario.
 *
 * Wire format: uppercase snake (e.g., "VALIDATION_ERROR").
 * All codes MUST be defined here — never use raw string literals.
 *
 * Usage:
 *   throw new AppError("Invalid input.", 400, ERROR_CODES.VALIDATION_ERROR);
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  KEY_RATE_LIMITED: "KEY_RATE_LIMITED",
  KEY_REVOKED: "KEY_REVOKED",
  KEY_PENDING: "KEY_PENDING",
  DOMAIN_MISMATCH: "DOMAIN_MISMATCH",
  TURNSTILE_FAILED: "TURNSTILE_FAILED",
  DNS_ERROR: "DNS_ERROR",
  RECOVERY_INVALID: "RECOVERY_INVALID",
  MISSING_API_KEY: "MISSING_API_KEY",
  INVALID_API_KEY: "INVALID_API_KEY",
  DOMAIN_KEY_LIMIT: "DOMAIN_KEY_LIMIT",
  VERIFICATION_ERROR: "VERIFICATION_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
  KEY_EXPIRED: "KEY_EXPIRED",
  CANNOT_SELF_REVOKE: "CANNOT_SELF_REVOKE",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: ErrorCode = ERROR_CODES.INTERNAL_ERROR,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, ERROR_CODES.VALIDATION_ERROR);
    this.name = "ValidationError";
  }
}

export class DatabaseError extends AppError {
  constructor(message: string) {
    super(message, 500, ERROR_CODES.DATABASE_ERROR);
    this.name = "DatabaseError";
  }
}
