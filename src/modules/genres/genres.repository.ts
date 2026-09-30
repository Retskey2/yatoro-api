import { asc, inArray } from "drizzle-orm";
import { db } from "@/database";
import { genres } from "@/database/schema";

export const GenresRepository = {
  getAll: async () => {
    return await db.select().from(genres).orderBy(asc(genres.name));
  },

  findByIds: async (ids: number[]) => {
    if (ids.length === 0) return [];
    return await db.select().from(genres).where(inArray(genres.id, ids));
  },

  create: async (data: typeof genres.$inferInsert) => {
    const [genre] = await db.insert(genres).values(data).returning();
    if (!genre) throw new Error("Insert into genres returned no rows");
    return genre;
  },
};
