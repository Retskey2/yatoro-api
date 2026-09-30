/**
 * Local Postgres without Docker or installation: PGlite (Postgres compiled to WASM)
 * served over the regular Postgres wire protocol, so the app connects to it
 * exactly like to a real server. Data is persisted in ./.pglite
 *
 *   bun run db:dev   →   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { SEARCH_SESSION_SQL } from "../src/database/search";

const port = Number(process.env.DEV_DB_PORT ?? 5432);
const dataDir = process.env.DEV_DB_DIR ?? ".pglite";

// Extensions used by migrations must be bundled into PGlite explicitly
const db = await PGlite.create(dataDir, { extensions: { pg_trgm } });

// All socket clients share this one PGlite session, which ignores startup parameters:
// session settings the app relies on are applied here once
await db.exec(SEARCH_SESSION_SQL);
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 20 });

await server.start();

const [{ version } = { version: "unknown" }] = (
  await db.query<{ version: string }>("select current_setting('server_version') as version")
).rows;

console.log(`🐘 PGlite (PostgreSQL ${version}) слушает 127.0.0.1:${port}, данные: ${dataDir}`);
console.log(`   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${port}/postgres`);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown());
}
