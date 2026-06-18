import { env } from "../env";

// Bun.sql — built-in, no external dependency needed.
// Bun's SQL class is available from the "bun" package.
// We re-export the type for convenience so callers don't need
// to import from "bun" directly.
export type { SQL } from "bun";

let _sql: import("bun").SQL | null = null;
let _sqlOptions: { max?: number } | null = null;

let _sqlRw: import("bun").SQL | null = null;
let _sqlRwOptions: { max?: number } | null = null;

export function getSql(): import("bun").SQL {
  if (!_sql) {
    const opts = { max: env.POOL_SIZE, min: 1 };
    if (!_sqlOptions || _sqlOptions.max !== opts.max) {
      _sqlOptions = opts;
    }
    const { SQL } = require("bun") as typeof import("bun");
    _sql = new SQL(env.DATABASE_URL, _sqlOptions);
  }
  return _sql;
}

export function getReadWriteSql(): import("bun").SQL {
  // When no dedicated RW URL is set, reuse the readonly pool to avoid
  // doubling Postgres connections ("too many clients already").
  if (!env.DATABASE_URL_READWRITE) {
    return getSql();
  }
  if (!_sqlRw) {
    const opts = { max: env.POOL_SIZE, min: 1 };
    if (!_sqlRwOptions) {
      _sqlRwOptions = opts;
    }
    const { SQL } = require("bun") as typeof import("bun");
    _sqlRw = new SQL(env.DATABASE_URL_READWRITE, _sqlRwOptions);
  }
  return _sqlRw;
}

// Intentionally a no-op. The postgres.js pool is reused across test files
// (Bun reuses worker processes), so nulling _sql/_sqlRw here would force a
// reconnect on every test file boundary. The OS cleans up sockets at exit.
// Callers (src/index.ts shutdown, afterAll hooks) should call this purely
// for shutdown symmetry, not for state reset. For state reset between tests
// use the targeted helpers: resetSuggestCache(), resetCorrector().
export async function closeDb(): Promise<void> {}
