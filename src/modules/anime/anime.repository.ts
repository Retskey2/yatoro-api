import { desc, eq, lt } from "drizzle-orm";
import { db } from "@/database";
import { anime, animeGenres } from "@/database/schema";

export const AnimeRepository = {
  /** Newest first, keyset pagination by id. Returns up to `limit + 1` rows */
  list: async ({ limit, cursor }: { limit: number; cursor?: number }) => {
    return await db
      .select()
      .from(anime)
      .where(cursor ? lt(anime.id, cursor) : undefined)
      .orderBy(desc(anime.id))
      .limit(limit + 1);
  },

  getById: async (id: number) => {
    return await db.query.anime.findFirst({
      where: eq(anime.id, id),
      with: {
        episodes: { orderBy: (episode, { asc }) => [asc(episode.number)] },
        animeGenres: { with: { genre: true } },
      },
    });
  },

  exists: async (id: number) => {
    const [row] = await db.select({ id: anime.id }).from(anime).where(eq(anime.id, id)).limit(1);
    return row !== undefined;
  },

  create: async (data: typeof anime.$inferInsert, genreIds: number[] = []) => {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(anime).values(data).returning();
      if (!created) throw new Error("Insert into anime returned no rows");

      if (genreIds.length > 0) {
        await tx
          .insert(animeGenres)
          .values(genreIds.map((genreId) => ({ animeId: created.id, genreId })));
      }

      return created;
    });
  },
};
