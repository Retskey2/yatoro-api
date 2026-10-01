import { isUniqueViolation } from "@/database/errors";
import type { AuditContext } from "@/modules/audit/audit.repository";
import { ConflictError } from "@/shared/errors";
import { toGenre } from "./genres.model";
import { GenresRepository } from "./genres.repository";

export class GenresService {
  async getAll() {
    const rows = await GenresRepository.getAll();
    return rows.map(toGenre);
  }

  async create(data: { name: string; slug: string }, audit: AuditContext) {
    try {
      return toGenre(await GenresRepository.create(data, audit));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("Жанр с таким названием или slug уже существует");
      }
      throw error;
    }
  }
}
