import { openapi } from "@elysiajs/openapi";
import { env } from "../env";

export const openapiConfig = openapi({
  documentation: {
    info: {
      title: "G-NAF Address Autocomplete API",
      version: "0.2.0",
      description:
        "Fast address autocomplete for Australian addresses using Geoscape Australia G-NAF data.\n\n" +
        "**Authentication**: Protected endpoints (`GET /suggest`, `GET /address/:id`) require an `X-API-Key` header " +
        "with a valid domain-verified API key. Get one at the `/keys` page.\n" +
        "Key management endpoints (`POST /api/keys`, `POST /api/keys/:prefix/verify`) are public " +
        "and use Cloudflare Turnstile for bot protection.\n\n" +
        "G-NAF © Geoscape Australia. See https://geoscape.com.au/data/g-naf/ for license terms.",
    },
    servers: [{ url: env.PUBLIC_URL || "http://localhost:8000" }],
    components: {
      securitySchemes: {
        apiKey: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description:
            "API key obtained from the /keys page. Pass via the X-API-Key header. " +
            "The Referer or Origin header must match the key's registered domain.",
        },
      },
    },
  },
  path: "/openapi",
  provider: null,
  exclude: {
    paths: ["/", "/analytics", "/docs", "/openapi"],
  },
});
