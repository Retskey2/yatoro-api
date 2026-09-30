import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "./columns";

export const studios = pgTable("studios", {
  id: id(),
  // Not unique on purpose: the source has distinct studios with identical names
  name: text().notNull(),
  slug: text().notNull().unique(),
  shikimoriId: integer().unique(),
  ...timestamps,
});

export type Studio = typeof studios.$inferSelect;
