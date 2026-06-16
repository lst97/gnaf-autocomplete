import { getReadWriteSql } from "../db/client";

/**
 * Touch a key within its rate-limit window: increment `rl_window_count`,
 * update `last_used_at`, and throttle-extend `expires_at` when within
 * 60 days of expiry.
 *
 * Call this when the key is active and within its rate-limit window.
 * The throttled extension fires only when `expires_at < now() + 60 days`,
 * capping writes to ~3 per 90-day lifetime per key.
 */

export async function touchKey(prefix: string, now: Date): Promise<void> {
  const sql = getReadWriteSql();
  await sql`
    UPDATE api_keys SET
      rl_window_count = rl_window_count + 1,
      request_count = request_count + 1,
      last_used_at = ${now},
      expires_at = CASE
        WHEN expires_at IS NOT NULL AND expires_at < ${now}::timestamptz + INTERVAL '60 days'
          THEN ${now}::timestamptz + INTERVAL '90 days'
        ELSE expires_at
      END
    WHERE prefix = ${prefix}
  `;
}

/**
 * Reset a key's rate-limit window (used when the previous window expired
 * or no window exists yet): set `rl_window_start`, reset `rl_window_count`
 * to 1, update `last_used_at`, and throttle-extend `expires_at`.
 */

export async function resetKeyWindow(prefix: string, now: Date): Promise<void> {
  const sql = getReadWriteSql();
  await sql`
    UPDATE api_keys SET
      rl_window_start = ${now},
      rl_window_count = 1,
      request_count = request_count + 1,
      last_used_at = ${now},
      expires_at = CASE
        WHEN expires_at IS NOT NULL AND expires_at < ${now}::timestamptz + INTERVAL '60 days'
          THEN ${now}::timestamptz + INTERVAL '90 days'
        ELSE expires_at
      END
    WHERE prefix = ${prefix}
  `;
}
