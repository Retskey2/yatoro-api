import { sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "@/database";

const DB_TIMEOUT_MS = 2_000;

/** `true` if the database answers within the timeout */
async function isDatabaseReachable(): Promise<boolean> {
  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), DB_TIMEOUT_MS));
  const ping = db.execute(sql`select 1`).then(
    () => true,
    () => false,
  );

  return await Promise.race([ping, timeout]);
}

const HealthResponse = t.Object({
  status: t.UnionEnum(["ok", "degraded"]),
  database: t.UnionEnum(["up", "down"]),
  uptime: t.Number(),
});

/** Liveness/readiness probe for Docker, load balancers and uptime monitors */
export const healthPlugin = new Elysia({ tags: ["Health"] }).get(
  "/health",
  async ({ status }) => {
    const uptime = Math.round(process.uptime());

    if (await isDatabaseReachable()) {
      return { status: "ok" as const, database: "up" as const, uptime };
    }

    return status(503, { status: "degraded" as const, database: "down" as const, uptime });
  },
  {
    response: { 200: HealthResponse, 503: HealthResponse },
    detail: { summary: "Состояние сервиса и базы данных" },
  },
);
