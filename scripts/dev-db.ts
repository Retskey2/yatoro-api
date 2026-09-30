/**
 * Local Postgres without Docker or installation: PGlite (Postgres compiled to WASM)
 * served over the regular Postgres wire protocol, so the app connects to it
 * exactly like to a real server. Data is persisted in ./.pglite
 *
 *   bun run db:dev   →   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const port = Number(process.env.DEV_DB_PORT ?? 5432);
const dataDir = process.env.DEV_DB_DIR ?? ".pglite";

const db = await PGlite.create(dataDir);
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
