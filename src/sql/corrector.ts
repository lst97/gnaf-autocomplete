import { getSql } from "../db/client";

export interface NameCountRow {
  name: string;
  n: number;
}

export async function fetchStreetNames(): Promise<NameCountRow[]> {
  const sql = getSql();
  return sql<NameCountRow[]>`
    SELECT street_lc AS name, COUNT(*)::int AS n
    FROM address_search_mv
    GROUP BY street_lc
  `;
}

export async function fetchLocalities(): Promise<NameCountRow[]> {
  const sql = getSql();
  return sql<NameCountRow[]>`
    SELECT locality_lc AS name, COUNT(*)::int AS n
    FROM address_search_mv
    GROUP BY locality_lc
  `;
}
