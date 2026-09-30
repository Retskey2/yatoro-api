import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./columns";
import { genres } from "./genre.schema";

export const ANIME_STATUSES = ["ANNOUNCED", "ONGOING", "RELEASED"] as const;
export type AnimeStatus = (typeof ANIME_STATUSES)[number];

export const animeStatusEnum = pgEnum("anime_status", ANIME_STATUSES);

export const anime = pgTable("anime", {
  id: id(),
  title: varchar({ length: 255 }).notNull(),
  description: text(),
  posterUrl: text(),
  status: animeStatusEnum().notNull().default("ANNOUNCED"),
  ...timestamps,
});

export const episodes = pgTable(
  "episodes",
  {
    id: id(),
    animeId: integer()
      .notNull()
      .references(() => anime.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    title: varchar({ length: 255 }),
    // Filled in once the video is uploaded (and, later, transcoded)
    videoUrl: text(),
    ...timestamps,
  },
  (t) => [
    unique("episodes_anime_number_unique").on(t.animeId, t.number),
    check("episodes_number_positive", sql`${t.number} > 0`),
  ],
);

export const animeGenres = pgTable(
  "anime_genres",
  {
    animeId: integer()
      .notNull()
      .references(() => anime.id, { onDelete: "cascade" }),
    genreId: integer()
      .notNull()
      .references(() => genres.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.animeId, t.genreId] }), index().on(t.genreId)],
);

export const animeRelations = relations(anime, ({ many }) => ({
  episodes: many(episodes),
  animeGenres: many(animeGenres),
}));

export const episodesRelations = relations(episodes, ({ one }) => ({
  anime: one(anime, { fields: [episodes.animeId], references: [anime.id] }),
}));

export const animeGenresRelations = relations(animeGenres, ({ one }) => ({
  anime: one(anime, { fields: [animeGenres.animeId], references: [anime.id] }),
  genre: one(genres, { fields: [animeGenres.genreId], references: [genres.id] }),
}));

export const genresRelations = relations(genres, ({ many }) => ({
  animeGenres: many(animeGenres),
}));

export type Anime = typeof anime.$inferSelect;
export type Episode = typeof episodes.$inferSelect;
