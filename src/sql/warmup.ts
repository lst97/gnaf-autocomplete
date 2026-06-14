/** Warmup query definitions — each targets a specific index tier. */
export const WARMUP_TASKS: Array<{ label: string; sql: string; params: (string | number)[] }> = [
  // Tier 0: state+postcode btree
  {
    label: "tier0",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE state = $1 AND postcode = $2 LIMIT 10",
    params: ["NSW", "2000"],
  },
  {
    label: "tier0",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE state = $1 AND postcode = $2 LIMIT 10",
    params: ["VIC", "3000"],
  },
  // Tier 0b: state + locality prefix
  {
    label: "tier0b",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE state = $1 AND locality_lc LIKE $2 LIMIT 10",
    params: ["NSW", "syd%"],
  },
  // Tier 0c: state + number_first
  {
    label: "tier0c",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE state = $1 AND number_first = $2 LIMIT 10",
    params: ["NSW", "12"],
  },
  // Postcode prefix: postcode LIKE
  {
    label: "postcode",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE postcode LIKE $1 LIMIT 10",
    params: ["20%"],
  },
  {
    label: "postcode",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE postcode LIKE $1 LIMIT 10",
    params: ["30%"],
  },
  // Tier 1: street prefix
  {
    label: "tier1",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE street_lc LIKE $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["sydne%"],
  },
  {
    label: "tier1",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE street_lc LIKE $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["main%"],
  },
  {
    label: "tier1",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE street_lc LIKE $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["george%"],
  },
  {
    label: "tier1",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE street_lc LIKE $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["queen%"],
  },
  {
    label: "tier1",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE street_lc LIKE $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["collins%"],
  },
  {
    label: "tier1",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE street_lc LIKE $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["perth%"],
  },
  // Trigram queries are intentionally skipped — 100-500ms each, not on the hot path
  {
    label: "postcode",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE postcode = $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["2000"],
  },
  {
    label: "postcode",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE postcode = $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["3000"],
  },
  {
    label: "postcode",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE postcode LIKE $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["2%"],
  },
  {
    label: "postcode",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE postcode LIKE $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["4%"],
  },
  // Extra warmers (tier1)
  {
    label: "tier1",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE street_lc LIKE $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["brisbane%"],
  },
  {
    label: "tier1",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE street_lc LIKE $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["adelaide%"],
  },
  {
    label: "tier1",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE street_lc LIKE $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["hobart%"],
  },
  {
    label: "tier1",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE street_lc LIKE $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["darwin%"],
  },
  {
    label: "tier1",
    sql: "SELECT address_detail_pid FROM address_search_mv WHERE street_lc LIKE $1 ORDER BY confidence_norm DESC, display LIMIT 10",
    params: ["canberra%"],
  },
];
