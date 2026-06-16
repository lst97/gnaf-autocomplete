import { getSql } from "../db/client";

export interface ApiKeyRow {
  key_hash: string;
  domain: string;
  status: string;
  expires_at: Date | null;
  rl_window_start: Date | null;
  rl_window_count: number;
}

export async function lookupApiKeyByPrefix(prefix: string): Promise<ApiKeyRow[]> {
  const sql = getSql();
  return sql`
    SELECT key_hash, domain, status, expires_at, rl_window_start, rl_window_count
    FROM api_keys
    WHERE prefix = ${prefix}
  ` as Promise<ApiKeyRow[]>;
}
