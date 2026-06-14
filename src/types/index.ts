import type { ErrorCode } from "../lib/errors";

/** Authenticated context injected by the auth derive middleware. */
export interface AuthContext {
  keyPrefix: string;
  domain: string;
}

/** Standard metadata block attached to all API responses. */
export interface ResponseMeta {
  /** Server-side processing time in ms. */
  took_ms: number;
  /** Unique request identifier (UUID). Honours inbound X-Request-Id header. */
  request_id: string;
  /** ISO 8601 UTC timestamp of when the response was generated. */
  timestamp: string;
}

/** Standard shape for error responses returned by the global onError handler. */
export interface ErrorResponseBody {
  /** Human-readable error message. */
  error: string;
  /** Machine-readable error code (from ERROR_CODES registry). */
  code: ErrorCode;
  /** Standard metadata block. */
  meta: ResponseMeta;
}
