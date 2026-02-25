import { env } from "@/config/env";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/database/schema/index.ts",

  out: "./src/database/migrations",

  dialect: "postgresql",

  dbCredentials: {
    url: env.DATABASE_URL!,
  },

  verbose: true,
  strict: true,
});
