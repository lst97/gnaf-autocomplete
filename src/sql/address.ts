import { getSql } from "../db/client";

export async function lookupAddressById(id: string) {
  const sql = getSql();
  return sql`
    SELECT
      address_detail_pid, display, street_lc, locality_lc,
      state, postcode, number_first, confidence, confidence_norm,
      lat, lon
    FROM address_search_mv
    WHERE address_detail_pid = ${id}
    LIMIT 1
  `;
}
