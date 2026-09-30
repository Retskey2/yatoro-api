import { pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "./columns";

export const genres = pgTable("genres", {
  id: id(),
  name: text().notNull().unique(),
  slug: text().notNull().unique(),
  ...timestamps,
});

export type Genre = typeof genres.$inferSelect;
