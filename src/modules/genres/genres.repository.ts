import { asc, inArray } from "drizzle-orm";
import { db } from "@/database";
import { genres } from "@/database/schema";
import { type AuditContext, AuditRepository, diffFields } from "@/modules/audit/audit.repository";

export const GenresRepository = {
  getAll: async () => {
    return await db.select().from(genres).orderBy(asc(genres.name));
  },

  findByIds: async (ids: number[]) => {
    if (ids.length === 0) return [];
    return await db.select().from(genres).where(inArray(genres.id, ids));
  },

  create: async (data: typeof genres.$inferInsert, audit: AuditContext) => {
    return await db.transaction(async (tx) => {
      const [genre] = await tx.insert(genres).values(data).returning();
      if (!genre) throw new Error("Insert into genres returned no rows");

      await AuditRepository.record(tx, {
        ...audit,
        action: "genre.create",
        entityType: "genre",
        entityId: genre.id,
        changes: diffFields({}, { name: genre.name, slug: genre.slug, kind: genre.kind }),
      });

      return genre;
    });
  },
};
