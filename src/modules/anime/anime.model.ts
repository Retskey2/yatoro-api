import { t } from "elysia";
import { ANIME_STATUSES, type Anime, type Episode as EpisodeRow } from "@/database/schema";
import { Genre } from "@/modules/genres/genres.model";

// Only our own uploads or https links: blocks `javascript:` and other unsafe schemes
const MediaUrl = t.String({ maxLength: 2048, pattern: "^(https://|/uploads/)" });

export const AnimeStatus = t.UnionEnum(ANIME_STATUSES);

export const AnimeSummary = t.Object({
  id: t.Integer(),
  title: t.String(),
  description: t.Nullable(t.String()),
  posterUrl: t.Nullable(t.String()),
  status: AnimeStatus,
  createdAt: t.Date(),
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
  genres: t.Array(Genre),
  episodes: t.Array(Episode),
});

export const CreateAnimeBody = t.Object({
  title: t.String({ minLength: 1, maxLength: 255 }),
  description: t.Optional(t.String({ maxLength: 10_000 })),
  posterUrl: t.Optional(MediaUrl),
  status: t.Optional(AnimeStatus),
  genreIds: t.Optional(t.Array(t.Integer({ minimum: 1 }), { uniqueItems: true, maxItems: 20 })),
});

export const CreateEpisodeBody = t.Object({
  number: t.Integer({ minimum: 1 }),
  title: t.Optional(t.String({ maxLength: 255 })),
  videoUrl: t.Optional(MediaUrl),
});

export const toAnimeSummary = (row: Anime) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  posterUrl: row.posterUrl,
  status: row.status,
  createdAt: row.createdAt,
});

export const toEpisode = (row: EpisodeRow) => ({
  id: row.id,
  animeId: row.animeId,
  number: row.number,
  title: row.title,
  videoUrl: row.videoUrl,
  createdAt: row.createdAt,
});
