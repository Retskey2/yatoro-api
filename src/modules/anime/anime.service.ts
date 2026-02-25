import { AnimeRepository } from "./anime.repository";
import { EpisodesRepository } from "../episodes/episodes.repository";
import { anime, episodes } from "@/database/schema";

export class AnimeService {
  async getAllAnime() {
    return await AnimeRepository.getAll();
  }

  async getAnimeById(id: number) {
    const animeData = await AnimeRepository.getById(id);

    if (!animeData) {
      throw new Error("Аниме не найдено");
    }

    return animeData;
  }

  async createAnime(data: typeof anime.$inferInsert) {
    return await AnimeRepository.create(data);
  }

  async addEpisodeToAnime(
    animeId: number,
    data: Omit<typeof episodes.$inferInsert, "animeId">,
  ) {
    const animeExists = await AnimeRepository.getById(animeId);
    if (!animeExists) {
      throw new Error("Аниме с таким ID не найдено");
    }

    return await EpisodesRepository.create({
      ...data,
      animeId,
    });
  }
}
