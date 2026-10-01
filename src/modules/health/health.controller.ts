import { sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "@/database";
import { isStorageReachable } from "@/shared/storage";

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
  storage: t.UnionEnum(["up", "down", "disabled"]),
  uptime: t.Number(),
});

/** Liveness/readiness probe for Docker, load balancers and uptime monitors */
export const healthPlugin = new Elysia({ tags: ["Health"] }).get(
  "/health",
  async ({ status }) => {
    const [databaseUp, storageUp] = await Promise.all([
      isDatabaseReachable(),
      isStorageReachable(),
    ]);

    const body = {
      database: databaseUp ? ("up" as const) : ("down" as const),
      // Storage is optional: not configured is fine, configured but unreachable is not
      storage:
        storageUp === null
          ? ("disabled" as const)
          : storageUp
            ? ("up" as const)
            : ("down" as const),
      uptime: Math.round(process.uptime()),
    };

    return databaseUp && storageUp !== false
      ? { status: "ok" as const, ...body }
      : status(503, { status: "degraded" as const, ...body });
  },
  {
    response: { 200: HealthResponse, 503: HealthResponse },
    detail: { summary: "Состояние сервиса, базы данных и хранилища" },
  },
);
