import { getSql } from "../db/client";

export interface ApiKeyRow {
  key_hash: string;
  domain: string;
  status: string;
  rl_window_start: Date | null;
  rl_window_count: number;
}

export async function lookupApiKeyByPrefix(prefix: string): Promise<ApiKeyRow[]> {
  const sql = getSql();
  return sql`
    SELECT key_hash, domain, status, rl_window_start, rl_window_count
    FROM api_keys
    WHERE prefix = ${prefix}
  ` as Promise<ApiKeyRow[]>;
}

export async function incrementKeyRateCount(prefix: string, now: Date): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE api_keys SET rl_window_count = rl_window_count + 1, last_used_at = ${now}
    WHERE prefix = ${prefix}
  `;
}

export async function resetKeyRateWindow(prefix: string, now: Date): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE api_keys SET rl_window_start = ${now}, rl_window_count = 1, last_used_at = ${now}
    WHERE prefix = ${prefix}
  `;
}

export async function incrementKeyRequestCount(prefix: string): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE api_keys SET request_count = request_count + 1
    WHERE prefix = ${prefix}
  `;
}
