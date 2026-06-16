import { getSql } from "../db/client";

export interface KeyStatsRow {
  active_keys: number;
  total_keys: number;
  total_requests: number;
  keys_this_week: number;
  active_key_requests: number;
}

export interface TopDomainKeyDetail {
  prefix: string;
  requests: number;
  last_used: Date | null;
}

export interface TopDomainRow {
  domain: string;
  total_requests: number;
  last_used_at: Date | null;
  keys: TopDomainKeyDetail[];
}

export interface AddressCountRow {
  address_count: number;
}

export async function fetchKeyStats(): Promise<KeyStatsRow[]> {
  const sql = getSql();
  return sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'active') AS active_keys,
      COUNT(*) AS total_keys,
      COALESCE(SUM(request_count), 0)::bigint AS total_requests,
      COUNT(*) FILTER (WHERE created_at > now() - interval '7 days') AS keys_this_week,
      COALESCE(SUM(request_count) FILTER (WHERE status = 'active'), 0)::bigint AS active_key_requests
    FROM api_keys
  ` as Promise<KeyStatsRow[]>;
}

export async function fetchTopDomains(limit = 10, offset = 0): Promise<TopDomainRow[]> {
  const sql = getSql();
  return sql`
    SELECT
      domain,
      SUM(request_count)::bigint AS total_requests,
      MAX(last_used_at) AS last_used_at,
      (
        SELECT COALESCE(json_agg(sub ORDER BY sub.requests DESC), '[]'::json)
        FROM (
          SELECT prefix, request_count AS requests, last_used_at AS last_used
          FROM api_keys AS ak
          WHERE ak.domain = api_keys.domain AND ak.status = 'active'
        ) sub
      ) AS keys
    FROM api_keys
    WHERE status = 'active'
    GROUP BY domain
    ORDER BY SUM(request_count) DESC
    LIMIT ${limit}
    OFFSET ${offset}
  ` as Promise<TopDomainRow[]>;
}

export async function fetchTopDomainsCount(): Promise<number> {
  const sql = getSql();
  const rows = await sql<Array<{ cnt: number }>>`
    SELECT COUNT(*)::bigint AS cnt
    FROM (SELECT domain FROM api_keys WHERE status = 'active' GROUP BY domain) sub
  `;
  return Number(rows[0]?.cnt ?? 0);
}

export async function fetchAddressCount(): Promise<AddressCountRow[]> {
  const sql = getSql();
  return sql`
    SELECT reltuples::bigint AS address_count
    FROM pg_class
    WHERE relname = 'address_search_mv'
  ` as Promise<AddressCountRow[]>;
}
