import { relations, sql } from "drizzle-orm";
import {
  check,
  customType,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  unique,
  varchar,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "./columns";
import { genres } from "./genre.schema";
import { studios } from "./studio.schema";

export const ANIME_STATUSES = ["ANNOUNCED", "ONGOING", "RELEASED"] as const;
export type AnimeStatus = (typeof ANIME_STATUSES)[number];

export const ANIME_KINDS = ["TV", "MOVIE", "OVA", "ONA", "SPECIAL", "MUSIC"] as const;
export type AnimeKind = (typeof ANIME_KINDS)[number];

export const AGE_RATINGS = ["G", "PG", "PG_13", "R", "R_PLUS"] as const;
export type AgeRating = (typeof AGE_RATINGS)[number];

export const SEASONS = ["WINTER", "SPRING", "SUMMER", "FALL"] as const;
export type Season = (typeof SEASONS)[number];

export const VIDEO_STATUSES = ["NONE", "UPLOADING", "PROCESSING", "READY", "FAILED"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const animeStatusEnum = pgEnum("anime_status", ANIME_STATUSES);
export const animeKindEnum = pgEnum("anime_kind", ANIME_KINDS);
export const ageRatingEnum = pgEnum("age_rating", AGE_RATINGS);
export const seasonEnum = pgEnum("season", SEASONS);
export const videoStatusEnum = pgEnum("video_status", VIDEO_STATUSES);

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/**
 * Hybrid search, both columns are maintained by Postgres itself (GENERATED ... STORED):
 * - search_vector: full-text with Russian/English stemming and weights (titles A, synonyms B, description D)
 * - search_text:   all titles in lower case for trigram similarity (typos, word forms, partial input)
 * `yatoro_array_to_text` is an IMMUTABLE wrapper created in a custom migration:
 * the built-in array_to_string is only STABLE and cannot be used in generated columns.
 */
const SEARCH_VECTOR = sql`
  setweight(to_tsvector('russian', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("title_en", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce("title_romaji", '')), 'A') ||
  setweight(to_tsvector('simple', yatoro_array_to_text("synonyms")), 'B') ||
  setweight(to_tsvector('russian', coalesce("description", '')), 'D')`;

const SEARCH_TEXT = sql`lower(
  coalesce("title", '') || ' ' || coalesce("title_en", '') || ' ' ||
  coalesce("title_romaji", '') || ' ' || coalesce("title_ja", '') || ' ' ||
  yatoro_array_to_text("synonyms"))`;

export const anime = pgTable(
  "anime",
  {
    id: id(),
    slug: text().notNull().unique(),
    title: varchar({ length: 255 }).notNull(),
    titleEn: text(),
    titleJa: text(),
    titleRomaji: text(),
    synonyms: text().array().notNull().default(sql`'{}'::text[]`),
    description: text(),
    posterUrl: text(),
    kind: animeKindEnum().notNull().default("TV"),
    status: animeStatusEnum().notNull().default("ANNOUNCED"),
    ageRating: ageRatingEnum(),
    episodesTotal: integer(),
    episodesAired: integer().notNull().default(0),
    durationMin: integer(),
    score: real(),
    airedOn: date({ mode: "string" }),
    releasedOn: date({ mode: "string" }),
    year: integer(),
    season: seasonEnum(),
    /** Position in the source's popularity ranking: 1 is the most popular */
    popularityRank: integer(),
    shikimoriId: integer().unique(),
    malId: integer().unique(),
    searchVector: tsvector().generatedAlwaysAs(SEARCH_VECTOR),
    searchText: text().generatedAlwaysAs(SEARCH_TEXT),
    ...timestamps,
  },
  (t) => [
    index("anime_search_vector_idx").using("gin", t.searchVector),
    index("anime_search_text_trgm_idx").using("gin", t.searchText.op("gin_trgm_ops")),
    // Keyset pagination indexes: exactly the (sort key, id) pairs used in ORDER BY
    // (see sortSpec in anime.repository.ts), so any page is an index range scan.
    // A btree is readable in both directions, so ASC indexes also serve DESC sorts.
    index("anime_popular_keyset_idx").on(sql`coalesce(${t.popularityRank}, 2147483647)`, t.id),
    index("anime_score_keyset_idx").on(sql`coalesce(${t.score}, -1)`, t.id),
    index("anime_newest_keyset_idx").on(sql`coalesce(${t.airedOn}, '0001-01-01'::date)`, t.id),
    index("anime_title_keyset_idx").on(t.title, t.id),
    index().on(t.year, t.season),
  ],
);

export const episodes = pgTable(
  "episodes",
  {
    id: id(),
    animeId: integer()
      .notNull()
      .references(() => anime.id, { onDelete: "cascade" }),
    number: integer().notNull(),
    title: varchar({ length: 255 }),
    // External video link set by hand (before the HLS pipeline); uploaded videos use the fields below
    videoUrl: text(),
    // Video pipeline: NONE → UPLOADING → PROCESSING → READY | FAILED (see docs/adr/0002)
    videoStatus: videoStatusEnum().notNull().default("NONE"),
    videoSourceKey: text(),
    videoHlsPrefix: text(),
    videoProgress: smallint().notNull().default(0),
    videoDurationSec: real(),
    videoError: text(),
    ...timestamps,
  },
  (t) => [
    unique("episodes_anime_number_unique").on(t.animeId, t.number),
    check("episodes_number_positive", sql`${t.number} > 0`),
    check("episodes_video_progress_range", sql`${t.videoProgress} between 0 and 100`),
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

export const animeStudios = pgTable(
  "anime_studios",
  {
    animeId: integer()
      .notNull()
      .references(() => anime.id, { onDelete: "cascade" }),
    studioId: integer()
      .notNull()
      .references(() => studios.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.animeId, t.studioId] }), index().on(t.studioId)],
);

export const animeRelations = relations(anime, ({ many }) => ({
  episodes: many(episodes),
  animeGenres: many(animeGenres),
  animeStudios: many(animeStudios),
}));

export const episodesRelations = relations(episodes, ({ one }) => ({
  anime: one(anime, { fields: [episodes.animeId], references: [anime.id] }),
}));

export const animeGenresRelations = relations(animeGenres, ({ one }) => ({
  anime: one(anime, { fields: [animeGenres.animeId], references: [anime.id] }),
  genre: one(genres, { fields: [animeGenres.genreId], references: [genres.id] }),
}));

export const animeStudiosRelations = relations(animeStudios, ({ one }) => ({
  anime: one(anime, { fields: [animeStudios.animeId], references: [anime.id] }),
  studio: one(studios, { fields: [animeStudios.studioId], references: [studios.id] }),
}));

export const genresRelations = relations(genres, ({ many }) => ({
  animeGenres: many(animeGenres),
}));

export const studiosRelations = relations(studios, ({ many }) => ({
  animeStudios: many(animeStudios),
}));

export type Anime = typeof anime.$inferSelect;
export type NewAnime = typeof anime.$inferInsert;
export type Episode = typeof episodes.$inferSelect;
