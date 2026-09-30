import { migrate } from "drizzle-orm/postgres-js/migrator";
import { client, db } from "./index";

export const MIGRATIONS_DIR = `${import.meta.dir}/migrations`;

if (import.meta.main) {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  console.log("✅ Миграции применены");
  await client.end();
}
