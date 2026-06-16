import { Elysia } from "elysia";
import { getSql } from "../db/client";
import { env } from "../env";
import { getReleaseInfoFromDb } from "../lib/version-check";

export const checkUpdateRoute = new Elysia().get(
  "/api/check-update",
  async () => {
    const sql = getSql();
    const info = await getReleaseInfoFromDb(sql);

    // Fall back to env.GNAF_VERSION when DB table/row doesn't exist yet
    const currentVersion = info?.current_version || env.GNAF_VERSION || "";
    const latestAvailableVersion = info?.latest_available_version ?? "";
    const downloadUrl = info?.latest_download_url ?? "";
    const updateAvailable = info?.update_available ?? false;
    const lastCheckedAt = info?.last_checked_at ?? null;

    let status: string;
    if (!latestAvailableVersion) {
      status = "not_checked";
    } else if (updateAvailable) {
      status = "update_available";
    } else {
      status = "up_to_date";
    }

    return {
      ok: true,
      currentVersion,
      latestAvailableVersion,
      downloadUrl,
      updateAvailable,
      status,
      lastCheckedAt,
    };
  },
  {
    detail: {
      tags: ["Version"],
      summary: "Check for G-NAF dataset updates",
      description:
        "Returns the current G-NAF version and the latest available version " +
        "from data.gov.au. The `updateAvailable` flag indicates whether a newer " +
        "release has been detected. Results are cached in the database by an " +
        "internal 24-hour scheduler — this endpoint does NOT fetch data.gov.au " +
        "directly, so it responds in <5ms.",
    },
  },
);
