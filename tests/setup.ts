/**
 * Test preload: runs before any test file is imported.
 *
 * The app talks to a real Postgres — PGlite (Postgres compiled to WASM, in-process),
 * so tests need no Docker and run the very same migrations as production.
 */
import { mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_URL = "pglite://memory";
process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters-long";
process.env.LOG_LEVEL = "silent";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.UPLOADS_DIR = mkdtempSync(join(tmpdir(), "yatoro-uploads-"));

// Imported dynamically so that env is configured first
const { PGlite } = await import("@electric-sql/pglite");
const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
const { drizzle } = await import("drizzle-orm/pglite");
const { migrate } = await import("drizzle-orm/pglite/migrator");
const schema = await import("../src/database/schema");

const client = new PGlite({ extensions: { pg_trgm } });
const db = drizzle(client, { schema, casing: "snake_case" });

await migrate(db, { migrationsFolder: join(import.meta.dir, "../src/database/migrations") });

// PGlite has a single session and ignores startup parameters, so settings are applied once here
const { SEARCH_SESSION_SQL } = await import("../src/database/search");
await client.exec(SEARCH_SESSION_SQL);

mock.module("@/database", () => ({ db, client }));

// The job queue runs on the same PGlite database (official pg-boss adapter)
const { PgBoss, fromPglite } = await import("pg-boss");
mock.module("@/queue/connection", () => ({
  createBoss: () =>
    new PgBoss({ db: fromPglite(client), backend: "pglite", supervise: false, schedule: false }),
}));
