// src/domains/anime/anime.repository.ts
import { db } from "@/database";
import { anime } from "@/database/schema";
import { eq } from "drizzle-orm";

export const AnimeRepository = {
  getAll: async () => {
    return await db.select().from(anime);
  },

  getById: async (id: number) => {
    const result = await db.query.anime.findFirst({
      where: eq(anime.id, id),
      with: {
        episodes: true,
      },
    });
    return result;
  },

  create: async (data: typeof anime.$inferInsert) => {
    const [newAnime] = await db.insert(anime).values(data).returning();
    return newAnime;
  },
};
