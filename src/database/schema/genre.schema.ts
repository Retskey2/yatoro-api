import { integer, pgEnum, pgTable, text } from "drizzle-orm/pg-core";
import { id, timestamps } from "./columns";

export const GENRE_KINDS = ["GENRE", "THEME", "DEMOGRAPHIC"] as const;
export type GenreKind = (typeof GENRE_KINDS)[number];

export const genreKindEnum = pgEnum("genre_kind", GENRE_KINDS);

export const genres = pgTable("genres", {
  id: id(),
  name: text().notNull().unique(),
  slug: text().notNull().unique(),
  kind: genreKindEnum().notNull().default("GENRE"),
  shikimoriId: integer().unique(),
  ...timestamps,
});

export type Genre = typeof genres.$inferSelect;
