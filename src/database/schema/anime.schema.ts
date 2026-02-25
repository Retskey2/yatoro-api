import {
  pgTable,
  serial,
  text,
  integer,
  varchar,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const anime = pgTable("anime", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  posterUrl: text("poster_url"),
  status: varchar("status", { length: 50 }).default("ONGOING"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const episodes = pgTable("episodes", {
  id: serial("id").primaryKey(),
  animeId: integer("anime_id")
    .references(() => anime.id, { onDelete: "cascade" })
    .notNull(),
  episodeNumber: integer("episode_number").notNull(),
  title: varchar("title", { length: 255 }),
  videoUrl: text("video_url").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const animeRelations = relations(anime, ({ many }) => ({
  episodes: many(episodes),
}));

export const episodesRelations = relations(episodes, ({ one }) => ({
  anime: one(anime, {
    fields: [episodes.animeId],
    references: [anime.id],
  }),
}));
