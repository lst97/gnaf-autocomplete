import { getSql } from "../db/client";

export async function pingDb(): Promise<void> {
  const sql = getSql();
  await sql`SELECT 1`;
}

export interface MvCheckRow {
  row_estimate: number;
  ispopulated: boolean;
}

export async function checkMvPopulated(): Promise<MvCheckRow[]> {
  const sql = getSql();
  return sql`
    SELECT
      c.reltuples::bigint AS row_estimate,
      s.ispopulated
    FROM pg_class c
    JOIN pg_matviews s ON s.matviewname = c.relname
    WHERE c.relname = 'address_search_mv'
  ` as Promise<MvCheckRow[]>;
}
