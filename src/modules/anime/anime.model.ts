import { t } from "elysia";
import {
  AGE_RATINGS,
  ANIME_KINDS,
  ANIME_STATUSES,
  type Anime,
  type Episode as EpisodeRow,
  SEASONS,
} from "@/database/schema";
import { Genre } from "@/modules/genres/genres.model";
import { StringEnum } from "@/shared/http";

export const CATALOG_SORTS = ["relevance", "popular", "score", "newest", "title"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

// Only our own uploads or https links: blocks `javascript:` and other unsafe schemes
const MediaUrl = t.String({ maxLength: 2048, pattern: "^(https://|/uploads/)" });
const IsoDate = t.String({ format: "date" });
const Slug = t.String({ minLength: 1, maxLength: 120, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" });

export const AnimeStatus = StringEnum(ANIME_STATUSES);
export const AnimeKind = StringEnum(ANIME_KINDS);
export const AgeRating = StringEnum(AGE_RATINGS);
export const Season = StringEnum(SEASONS);

export const Studio = t.Object({
  id: t.Integer(),
  name: t.String(),
  slug: t.String(),
});

const GenreRef = t.Object({ id: t.Integer(), name: t.String(), slug: t.String() });

export const AnimeSummary = t.Object({
  id: t.Integer(),
  slug: t.String(),
  title: t.String(),
  titleEn: t.Nullable(t.String()),
  posterUrl: t.Nullable(t.String()),
  kind: AnimeKind,
  status: AnimeStatus,
  year: t.Nullable(t.Integer()),
  season: t.Nullable(Season),
  score: t.Nullable(t.Number()),
  episodesTotal: t.Nullable(t.Integer()),
  episodesAired: t.Integer(),
  genres: t.Array(GenreRef),
});

export const Episode = t.Object({
  id: t.Integer(),
  animeId: t.Integer(),
  number: t.Integer(),
  title: t.Nullable(t.String()),
  videoUrl: t.Nullable(t.String()),
  createdAt: t.Date(),
});

export const AnimeDetails = t.Object({
  ...AnimeSummary.properties,
  titleJa: t.Nullable(t.String()),
  titleRomaji: t.Nullable(t.String()),
  synonyms: t.Array(t.String()),
  description: t.Nullable(t.String()),
  ageRating: t.Nullable(AgeRating),
  durationMin: t.Nullable(t.Integer()),
  airedOn: t.Nullable(t.String()),
  releasedOn: t.Nullable(t.String()),
  genres: t.Array(Genre),
  studios: t.Array(Studio),
  episodes: t.Array(Episode),
});

export const CatalogQuery = t.Object({
  q: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  genres: t.Optional(t.Array(Slug, { maxItems: 10, uniqueItems: true })),
  kind: t.Optional(t.Array(AnimeKind, { uniqueItems: true })),
  status: t.Optional(t.Array(AnimeStatus, { uniqueItems: true })),
  season: t.Optional(Season),
  yearFrom: t.Optional(t.Integer({ minimum: 1900, maximum: 2100 })),
  yearTo: t.Optional(t.Integer({ minimum: 1900, maximum: 2100 })),
  scoreMin: t.Optional(t.Number({ minimum: 0, maximum: 10 })),
  sort: t.Optional(StringEnum(CATALOG_SORTS)),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20 })),
  cursor: t.Optional(t.String({ maxLength: 300 })),
});

export const CreateAnimeBody = t.Object({
  title: t.String({ minLength: 1, maxLength: 255 }),
  slug: t.Optional(Slug),
  titleEn: t.Optional(t.String({ maxLength: 255 })),
  titleJa: t.Optional(t.String({ maxLength: 255 })),
  titleRomaji: t.Optional(t.String({ maxLength: 255 })),
  synonyms: t.Optional(t.Array(t.String({ maxLength: 255 }), { maxItems: 30 })),
  description: t.Optional(t.String({ maxLength: 10_000 })),
  posterUrl: t.Optional(MediaUrl),
  kind: t.Optional(AnimeKind),
  status: t.Optional(AnimeStatus),
  ageRating: t.Optional(AgeRating),
  episodesTotal: t.Optional(t.Integer({ minimum: 0 })),
  durationMin: t.Optional(t.Integer({ minimum: 0 })),
  airedOn: t.Optional(IsoDate),
  releasedOn: t.Optional(IsoDate),
  genreIds: t.Optional(t.Array(t.Integer({ minimum: 1 }), { uniqueItems: true, maxItems: 20 })),
});

export const CreateEpisodeBody = t.Object({
  number: t.Integer({ minimum: 1 }),
  title: t.Optional(t.String({ maxLength: 255 })),
  videoUrl: t.Optional(MediaUrl),
});

type GenreRefRow = { id: number; name: string; slug: string };

export const toAnimeSummary = (row: Anime, genres: GenreRefRow[] = []) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  titleEn: row.titleEn,
  posterUrl: row.posterUrl,
  kind: row.kind,
  status: row.status,
  year: row.year,
  season: row.season,
  score: row.score,
  episodesTotal: row.episodesTotal,
  episodesAired: row.episodesAired,
  genres,
});

export const toEpisode = (row: EpisodeRow) => ({
  id: row.id,
  animeId: row.animeId,
  number: row.number,
  title: row.title,
  videoUrl: row.videoUrl,
  createdAt: row.createdAt,
});
