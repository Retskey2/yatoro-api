import { PgBoss } from "pg-boss";
import { env } from "@/config/env";

export type QueueRole = "producer" | "worker";

/**
 * pg-boss runs its own small `pg` pool for its own work: schema migrations, fetching jobs,
 * retries. Our transactions reach it through `fromDrizzle` (see `enqueue`).
 * Replaced by a PGlite-backed instance in tests (tests/setup.ts).
 */
export function createBoss(role: QueueRole): PgBoss {
  return new PgBoss({
    connectionString: env.DATABASE_URL,
    max: 3,
    application_name: `yatoro-${role}`,
    // Maintenance and cron belong to the worker; the API only enqueues
    supervise: role === "worker",
    schedule: role === "worker",
  });
}
