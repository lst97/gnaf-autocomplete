import { getConfig } from "../config";

// Bun.sql — built-in, no external dependency needed.
// Bun's SQL class is available from the "bun" package.
// We re-export the type for convenience so callers don't need
// to import from "bun" directly.
export type { SQL } from "bun";

let _sql: import("bun").SQL | null = null;
let _sqlOptions: { max?: number } | null = null;

export function getSql(): import("bun").SQL {
  if (!_sql) {
    const config = getConfig();
    // Recreate pool options only if config changed (handles test resets)
    const opts = { max: config.POOL_SIZE, min: 1 };
    if (!_sqlOptions || _sqlOptions.max !== opts.max) {
      _sqlOptions = opts;
    }
    const { SQL } = require("bun") as typeof import("bun");
    _sql = new SQL(config.DATABASE_URL, _sqlOptions);
  }
  return _sql;
}

export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.close();
    _sql = null;
    _sqlOptions = null;
  }
}
