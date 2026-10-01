import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/config/env";
import * as schema from "./schema";
import { SEARCH_SESSION_SETTINGS } from "./search";

export const client = postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_MAX,
  connect_timeout: 10,
  // Sent in the startup packet, so every pooled connection has it without an extra query
  connection: SEARCH_SESSION_SETTINGS,
});
export const db = drizzle(client, { schema, casing: "snake_case" });

export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run a query: the pool itself or an open transaction */
export type Executor = Database | Transaction;
