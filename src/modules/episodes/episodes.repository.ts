import { db } from "@/database";
import { episodes } from "@/database/schema";

export const EpisodesRepository = {
  create: async (data: typeof episodes.$inferInsert) => {
    const [newEpisode] = await db.insert(episodes).values(data).returning();
    return newEpisode;
  },
};
