import { Elysia, t } from "elysia";
import { AppError, ERROR_CODES } from "../lib/errors";
import { lookupAddressById } from "../sql/address";

export const addressRoute = new Elysia().get(
  "/address/:id",
  async ({ params: { id } }) => {
    const rows = await lookupAddressById(id);

    if (rows.length === 0) {
      throw new AppError("Address not found", 404, ERROR_CODES.NOT_FOUND);
    }

    const r = rows[0] as Record<string, unknown>;
    return {
      id: String(r.address_detail_pid ?? ""),
      display: String(r.display ?? ""),
      street_lc: String(r.street_lc ?? ""),
      locality_lc: String(r.locality_lc ?? ""),
      state: String(r.state ?? ""),
      postcode: String(r.postcode ?? ""),
      number_first: r.number_first != null ? Number(r.number_first) : null,
      confidence: r.confidence != null ? Number(r.confidence) : null,
      confidence_norm: r.confidence_norm != null ? Number(r.confidence_norm) : null,
      lat: r.lat != null ? Number(r.lat) : null,
      lon: r.lon != null ? Number(r.lon) : null,
    };
  },
  {
    params: t.Object({
      id: t.String({
        minLength: 10,
        maxLength: 20,
        description: "G-NAF address_detail_pid (e.g. GANSW706063331)",
        example: "GANSW706063331",
      }),
    }),
    response: {
      200: t.Object({
        id: t.String({ description: "G-NAF persistent identifier." }),
        display: t.String({ description: "Formatted address string." }),
        street_lc: t.String({ description: "Lowercased street name." }),
        locality_lc: t.String({ description: "Lowercased locality name." }),
        state: t.String({ description: "State abbreviation." }),
        postcode: t.String({ description: "Postcode." }),
        number_first: t.Nullable(t.Number({ description: "Street number." })),
        confidence: t.Nullable(t.Number({ description: "Raw G-NAF confidence (-1 to 6)." })),
        confidence_norm: t.Nullable(t.Number({ description: "Normalized confidence (0.0-1.0)." })),
        lat: t.Nullable(t.Number({ description: "Latitude." })),
        lon: t.Nullable(t.Number({ description: "Longitude." })),
      }),
      404: t.Object({
        error: t.String(),
        code: t.String(),
      }),
    },
    detail: {
      tags: ["Search"],
      summary: "Address details by PID",
      description:
        "Returns the full G-NAF address record for a given address_detail_pid. " +
        "Use the `id` from `/suggest` results to fetch complete details. Response time <1ms via UNIQUE index.\n\n" +
        "**Authentication**: Requires `X-API-Key` header with a valid domain-verified API key.",
    },
  },
);
