import { isUniqueViolation } from "@/database/errors";
import type { episodes } from "@/database/schema";
import type { AuditContext } from "@/modules/audit/audit.repository";
import { toGenre } from "@/modules/genres/genres.model";
import { GenresRepository } from "@/modules/genres/genres.repository";
import { BadRequestError, ConflictError, NotFoundError } from "@/shared/errors";
import { decodeCursor, encodeCursor } from "@/shared/http";
import { seasonOf, slugify } from "@/shared/text";
import { EpisodesRepository } from "../episodes/episodes.repository";
import {
  type CatalogQuery as CatalogQuerySchema,
  type CatalogSort,
  type CreateAnimeBody,
  toEpisode,
  type UpdateAnimeBody,
  type UpdateEpisodeBody,
} from "./anime.model";
import { AnimeRepository } from "./anime.repository";

type CatalogQuery = typeof CatalogQuerySchema.static;
type CreateAnimeDTO = typeof CreateAnimeBody.static;
type UpdateAnimeDTO = typeof UpdateAnimeBody.static;
type UpdateEpisodeDTO = typeof UpdateEpisodeBody.static;
type CreateEpisodeDTO = Omit<
  typeof episodes.$inferInsert,
  "id" | "animeId" | "createdAt" | "updatedAt"
>;

type Details = NonNullable<Awaited<ReturnType<typeof AnimeRepository.getById>>>;

export class AnimeService {
  async getCatalogPage({ cursor, limit = 20, sort: requestedSort, ...rest }: CatalogQuery) {
    const q = rest.q?.trim().toLowerCase() || undefined;
    const sort: CatalogSort = requestedSort ?? (q ? "relevance" : "popular");

    if (sort === "relevance" && !q) {
      throw new BadRequestError("Сортировка по релевантности доступна только вместе с q");
    }
    if (rest.yearFrom && rest.yearTo && rest.yearFrom > rest.yearTo) {
      throw new BadRequestError("yearFrom не может быть больше yearTo");
    }

    const rows = await AnimeRepository.search({
      filters: { ...rest, q },
      sort,
      limit,
      cursor: cursor ? decodeCursor(cursor, sort) : undefined,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map(({ sortKey: _, ...item }) => item),
      nextCursor: hasMore && last ? encodeCursor({ sort, key: last.sortKey, id: last.id }) : null,
    };
  }

  async getAnimeById(id: number) {
    return toDetails(await AnimeRepository.getById(id));
  }

  async getAnimeBySlug(slug: string) {
    return toDetails(await AnimeRepository.getBySlug(slug));
  }

  async createAnime({ genreIds = [], slug, ...data }: CreateAnimeDTO, audit: AuditContext) {
    const found = await findGenresOrThrow(genreIds);

    const finalSlug =
      slug ?? (slugify(data.titleRomaji ?? data.titleEn ?? data.title) || `anime-${Date.now()}`);

    try {
      const created = await AnimeRepository.create(
        { ...data, slug: finalSlug, ...(data.airedOn ? seasonOf(data.airedOn) : {}) },
        genreIds,
        audit,
      );
      const genresById = new Map(found.map((genre) => [genre.id, genre]));
      return {
        ...created,
        genres: genreIds.flatMap((id) => {
          const genre = genresById.get(id);
          return genre ? [{ id: genre.id, name: genre.name, slug: genre.slug }] : [];
        }),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`Slug «${finalSlug}» уже занят — передайте другой slug`);
      }
      throw error;
    }
  }

  async updateAnime(
    id: number,
    { genreIds, airedOn, ...patch }: UpdateAnimeDTO,
    audit: AuditContext,
  ) {
    if (genreIds) await findGenresOrThrow(genreIds);

    // Year and season are derived from the premiere date, so they move together
    const derived =
      airedOn === undefined
        ? {}
        : { airedOn, ...(airedOn ? seasonOf(airedOn) : { year: null, season: null }) };

    try {
      const found = await AnimeRepository.update(id, { ...patch, ...derived }, genreIds, audit);
      if (!found) throw new NotFoundError("Аниме не найдено");
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`Slug «${patch.slug}» уже занят — передайте другой slug`);
      }
      throw error;
    }

    return await this.getAnimeById(id);
  }

  async deleteAnime(id: number, audit: AuditContext) {
    if (!(await AnimeRepository.delete(id, audit))) {
      throw new NotFoundError("Аниме не найдено");
    }
  }

  async addEpisodeToAnime(animeId: number, data: CreateEpisodeDTO, audit: AuditContext) {
    if (!(await AnimeRepository.exists(animeId))) {
      throw new NotFoundError("Аниме с таким ID не найдено");
    }

    try {
      return toEpisode(await EpisodesRepository.create({ ...data, animeId }, audit));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`Серия ${data.number} у этого аниме уже существует`);
      }
      throw error;
    }
  }

  async updateEpisode(
    animeId: number,
    number: number,
    patch: UpdateEpisodeDTO,
    audit: AuditContext,
  ) {
    try {
      const updated = await EpisodesRepository.update(animeId, number, patch, audit);
      if (!updated) throw new NotFoundError(`Серия ${number} не найдена`);
      return toEpisode(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`Серия ${patch.number} у этого аниме уже существует`);
      }
      throw error;
    }
  }

  async deleteEpisode(animeId: number, number: number, audit: AuditContext) {
    if (!(await EpisodesRepository.delete(animeId, number, audit))) {
      throw new NotFoundError(`Серия ${number} не найдена`);
    }
  }
}

async function findGenresOrThrow(genreIds: number[]) {
  const found = await GenresRepository.findByIds(genreIds);

  if (found.length !== genreIds.length) {
    const foundIds = new Set(found.map((genre) => genre.id));
    throw new BadRequestError("Некоторые жанры не найдены", {
      missingGenreIds: genreIds.filter((id) => !foundIds.has(id)),
    });
  }

  return found;
}

function toDetails(row: Details | undefined) {
  if (!row) {
    throw new NotFoundError("Аниме не найдено");
  }

  const { animeGenres, animeStudios, episodes, createdAt: _c, updatedAt: _u, ...rest } = row;
  return {
    ...rest,
    genres: animeGenres.map(({ genre }) => toGenre(genre)),
    studios: animeStudios.map(({ studio }) => ({
      id: studio.id,
      name: studio.name,
      slug: studio.slug,
    })),
    episodes: episodes.map(toEpisode),
  };
}
