import { Elysia } from "elysia";
import { fetchAddressCount, fetchKeyStats, fetchTopDomains } from "../sql/stats";

export const statsRoute = new Elysia().get(
  "/api/stats",
  async () => {
    const [keyStats, topDomains, totalSuggestRows] = await Promise.all([
      fetchKeyStats(),
      fetchTopDomains(10),
      fetchAddressCount(),
    ]);

    const ks = keyStats[0] as {
      active_keys: number;
      total_keys: number;
      total_requests: number;
      keys_this_week: number;
      active_key_requests: number;
    };

    const addressCount = (totalSuggestRows[0] as { address_count: number })?.address_count ?? 0;

    return {
      keys: {
        active: Number(ks.active_keys),
        total: Number(ks.total_keys),
        created_this_week: Number(ks.keys_this_week),
        total_requests: Number(ks.total_requests),
        active_key_requests: Number(ks.active_key_requests),
      },
      top_domains: topDomains.map((r) => ({
        domain: r.domain,
        requests: Number(r.total_requests),
        last_used: r.last_used_at,
        keys: (r.keys as Array<{ prefix: string; requests: number; last_used: Date | null }>).map(
          (k) => ({
            prefix: k.prefix,
            requests: Number(k.requests),
            last_used: k.last_used,
          }),
        ),
      })),
      addresses: Number(addressCount),
    };
  },
  {
    detail: {
      tags: ["Meta"],
      summary: "Public usage statistics",
      description:
        "Aggregated API usage stats — active keys, total requests, top domains. " +
        "No sensitive or per-key identifiable data is exposed beyond domain names.",
    },
  },
);
