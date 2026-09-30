import { isUniqueViolation } from "@/database/errors";
import { ConflictError } from "@/shared/errors";
import { toGenre } from "./genres.model";
import { GenresRepository } from "./genres.repository";

export class GenresService {
  async getAll() {
    const rows = await GenresRepository.getAll();
    return rows.map(toGenre);
  }

  async create(data: { name: string; slug: string }) {
    try {
      return toGenre(await GenresRepository.create(data));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("Жанр с таким названием или slug уже существует");
      }
      throw error;
    }
  }
}
