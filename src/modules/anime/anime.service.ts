import { isUniqueViolation } from "@/database/errors";
import type { anime, episodes } from "@/database/schema";
import { toGenre } from "@/modules/genres/genres.model";
import { GenresRepository } from "@/modules/genres/genres.repository";
import { BadRequestError, ConflictError, NotFoundError } from "@/shared/errors";
import { toPage } from "@/shared/http";
import { EpisodesRepository } from "../episodes/episodes.repository";
import { toAnimeSummary, toEpisode } from "./anime.model";
import { AnimeRepository } from "./anime.repository";

type CreateAnimeDTO = Omit<typeof anime.$inferInsert, "id" | "createdAt" | "updatedAt"> & {
  genreIds?: number[];
};

type CreateEpisodeDTO = Omit<
  typeof episodes.$inferInsert,
  "id" | "animeId" | "createdAt" | "updatedAt"
>;

export class AnimeService {
  async getAnimePage(query: { limit?: number; cursor?: number }) {
    const limit = query.limit ?? 20;
    const rows = await AnimeRepository.list({ limit, cursor: query.cursor });
    return toPage(rows.map(toAnimeSummary), limit);
  }

  async getAnimeById(id: number) {
    const animeData = await AnimeRepository.getById(id);

    if (!animeData) {
      throw new NotFoundError("Аниме не найдено");
    }

    return {
      ...toAnimeSummary(animeData),
      genres: animeData.animeGenres.map(({ genre }) => toGenre(genre)),
      episodes: animeData.episodes.map(toEpisode),
    };
  }

  async createAnime({ genreIds = [], ...data }: CreateAnimeDTO) {
    const found = await GenresRepository.findByIds(genreIds);

    if (found.length !== genreIds.length) {
      const foundIds = new Set(found.map((genre) => genre.id));
      throw new BadRequestError("Некоторые жанры не найдены", {
        missingGenreIds: genreIds.filter((id) => !foundIds.has(id)),
      });
    }

    return toAnimeSummary(await AnimeRepository.create(data, genreIds));
  }

  async addEpisodeToAnime(animeId: number, data: CreateEpisodeDTO) {
    if (!(await AnimeRepository.exists(animeId))) {
      throw new NotFoundError("Аниме с таким ID не найдено");
    }

    try {
      return toEpisode(await EpisodesRepository.create({ ...data, animeId }));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`Серия ${data.number} у этого аниме уже существует`);
      }
      throw error;
    }
  }
}
