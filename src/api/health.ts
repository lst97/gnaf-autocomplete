import { Elysia } from "elysia";
import { checkMvPopulated, pingDb } from "../sql/health";

export const healthRoute = new Elysia()
  .get("/healthz", () => ({ status: "ok" }), {
    detail: {
      tags: ["Health"],
      summary: "Liveness probe",
      description:
        "Returns 200 OK when the service process is running. Does NOT check the database connection \u2014 use `/readyz` for that.",
    },
  })
  .get(
    "/readyz",
    async () => {
      try {
        await pingDb();
        const mvCheck = await checkMvPopulated();
        const row = mvCheck[0];
        const mvRows = Number(row?.row_estimate ?? 0);
        const isPopulated = row?.ispopulated === true && mvRows > 0;
        if (isPopulated) {
          return { status: "ready", db: "connected", mv_populated: true, mv_rows: mvRows };
        }
        return { status: "degraded", db: "connected", mv_populated: false, mv_rows: 0 };
      } catch {
        return { status: "not ready", db: "disconnected" };
      }
    },
    {
      detail: {
        tags: ["Health"],
        summary: "Readiness probe (checks DB + MV)",
        description:
          'Returns `status: "ready"` when the database is connected AND the MV has rows. ' +
          'Returns `status: "degraded"` when DB is up but MV is empty. ' +
          'Returns `status: "not ready"` when the database is unreachable.',
      },
    },
  );
