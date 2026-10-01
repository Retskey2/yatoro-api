import { and, eq } from "drizzle-orm";
import { db } from "@/database";
import { type Episode, episodes } from "@/database/schema";
import { type AuditContext, AuditRepository, diffFields } from "@/modules/audit/audit.repository";

type EpisodePatch = Partial<Pick<Episode, "number" | "title" | "videoUrl">>;

// The audit log stores what matters about an episode, without timestamps
const loggable = ({ animeId, number, title, videoUrl }: Episode) => ({
  animeId,
  number,
  title,
  videoUrl,
});

const byNumber = (animeId: number, number: number) =>
  and(eq(episodes.animeId, animeId), eq(episodes.number, number));

export const EpisodesRepository = {
  create: async (data: typeof episodes.$inferInsert, audit: AuditContext) => {
    return await db.transaction(async (tx) => {
      const [episode] = await tx.insert(episodes).values(data).returning();
      if (!episode) throw new Error("Insert into episodes returned no rows");

      await AuditRepository.record(tx, {
        ...audit,
        action: "episode.create",
        entityType: "episode",
        entityId: episode.id,
        changes: diffFields({}, loggable(episode)),
      });

      return episode;
    });
  },

  /** Returns undefined if the episode does not exist */
  update: async (animeId: number, number: number, patch: EpisodePatch, audit: AuditContext) => {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(episodes)
        .where(byNumber(animeId, number))
        .for("update");
      if (!before) return undefined;

      const [after] = await tx
        .update(episodes)
        .set(patch)
        .where(eq(episodes.id, before.id))
        .returning();
      if (!after) throw new Error("Update of episodes returned no rows");

      const changes = diffFields(loggable(before), loggable(after));
      if (Object.keys(changes).length > 0) {
        await AuditRepository.record(tx, {
          ...audit,
          action: "episode.update",
          entityType: "episode",
          entityId: before.id,
          changes,
        });
      }

      return after;
    });
  },

  /** Returns false if the episode does not exist */
  delete: async (animeId: number, number: number, audit: AuditContext) => {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(episodes)
        .where(byNumber(animeId, number))
        .for("update");
      if (!before) return false;

      await tx.delete(episodes).where(eq(episodes.id, before.id));
      await AuditRepository.record(tx, {
        ...audit,
        action: "episode.delete",
        entityType: "episode",
        entityId: before.id,
        changes: diffFields(loggable(before), {}),
      });

      return true;
    });
  },
};
