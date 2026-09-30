import { db } from "@/database";
import { episodes } from "@/database/schema";

export const EpisodesRepository = {
  create: async (data: typeof episodes.$inferInsert) => {
    const [episode] = await db.insert(episodes).values(data).returning();
    if (!episode) throw new Error("Insert into episodes returned no rows");
    return episode;
  },
};
