import { and, eq } from "drizzle-orm";
import { db } from "@/database";
import { type Episode, episodes } from "@/database/schema";
import { type AuditContext, AuditRepository, diffFields } from "@/modules/audit/audit.repository";
import { enqueue, QUEUES } from "@/queue";

const videoFields = (episode: Episode) => ({
  videoStatus: episode.videoStatus,
  videoSourceKey: episode.videoSourceKey,
  videoError: episode.videoError,
});

const byNumber = (animeId: number, number: number) =>
  and(eq(episodes.animeId, animeId), eq(episodes.number, number));

/**
 * Video state transitions. Each one is a short transaction: lock the row, check the state,
 * update it, log it and — where needed — enqueue the follow-up job in the same transaction.
 * Storage I/O never happens inside these transactions.
 */
export const VideoRepository = {
  find: async (animeId: number, number: number) => {
    const [episode] = await db.select().from(episodes).where(byNumber(animeId, number)).limit(1);
    return episode;
  },

  /** → UPLOADING with a fresh source key; the previous source (if any) is scheduled for deletion */
  startUpload: async (episodeId: number, sourceKey: string, audit: AuditContext) => {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(episodes)
        .where(eq(episodes.id, episodeId))
        .for("update");
      if (!before) return { kind: "not_found" } as const;
      // Replacing a video that is being transcoded would race with the worker
      if (before.videoStatus === "PROCESSING") return { kind: "busy" } as const;

      const [after] = await tx
        .update(episodes)
        .set({
          videoStatus: "UPLOADING",
          videoSourceKey: sourceKey,
          videoError: null,
          videoProgress: 0,
        })
        .where(eq(episodes.id, episodeId))
        .returning();
      if (!after) throw new Error("Update of episodes returned no rows");

      if (before.videoSourceKey) {
        await enqueue(tx, QUEUES.cleanup, { keys: [before.videoSourceKey] });
      }

      await AuditRepository.record(tx, {
        ...audit,
        action: "video.upload_requested",
        entityType: "episode",
        entityId: episodeId,
        changes: diffFields(videoFields(before), videoFields(after)),
      });

      return { kind: "ok", episode: after } as const;
    });
  },

  /**
   * UPLOADING → PROCESSING and the transcode job, atomically. Returns `undefined` if the upload
   * was restarted (another source key) or finished by someone else in the meantime.
   */
  markUploaded: async (episodeId: number, sourceKey: string, audit: AuditContext) => {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(episodes)
        .where(eq(episodes.id, episodeId))
        .for("update");
      if (before?.videoStatus !== "UPLOADING" || before.videoSourceKey !== sourceKey) {
        return undefined;
      }

      const [after] = await tx
        .update(episodes)
        .set({ videoStatus: "PROCESSING", videoProgress: 0 })
        .where(eq(episodes.id, episodeId))
        .returning();
      if (!after) throw new Error("Update of episodes returned no rows");

      await enqueue(tx, QUEUES.transcode, { episodeId, sourceKey });

      await AuditRepository.record(tx, {
        ...audit,
        action: "video.uploaded",
        entityType: "episode",
        entityId: episodeId,
        changes: diffFields(videoFields(before), videoFields(after)),
      });

      return after;
    });
  },

  // ---- transitions made by the worker (a system actor: not in the admin audit log) ----

  /** Only while this exact source is still being processed: a stale job must not touch the episode */
  setProgress: async (episodeId: number, sourceKey: string, progress: number) => {
    await db
      .update(episodes)
      .set({ videoProgress: progress })
      .where(
        and(
          eq(episodes.id, episodeId),
          eq(episodes.videoStatus, "PROCESSING"),
          eq(episodes.videoSourceKey, sourceKey),
        ),
      );
  },

  /**
   * PROCESSING → READY. The previous HLS version (if any) is scheduled for deletion in the same
   * transaction. Returns false if the upload was replaced meanwhile — the caller then deletes
   * what it has just produced.
   */
  markReady: async (
    episodeId: number,
    sourceKey: string,
    result: { hlsPrefix: string; durationSec: number },
  ) => {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(episodes)
        .where(eq(episodes.id, episodeId))
        .for("update");
      if (before?.videoStatus !== "PROCESSING" || before.videoSourceKey !== sourceKey) return false;

      await tx
        .update(episodes)
        .set({
          videoStatus: "READY",
          videoProgress: 100,
          videoHlsPrefix: result.hlsPrefix,
          videoDurationSec: result.durationSec,
          videoError: null,
        })
        .where(eq(episodes.id, episodeId));

      if (before.videoHlsPrefix && before.videoHlsPrefix !== result.hlsPrefix) {
        await enqueue(tx, QUEUES.cleanup, { prefixes: [before.videoHlsPrefix] });
      }
      return true;
    });
  },

  /** PROCESSING → FAILED after the last attempt */
  markFailed: async (episodeId: number, sourceKey: string, reason: string) => {
    await db
      .update(episodes)
      .set({ videoStatus: "FAILED", videoError: reason.slice(0, 500) })
      .where(
        and(
          eq(episodes.id, episodeId),
          eq(episodes.videoStatus, "PROCESSING"),
          eq(episodes.videoSourceKey, sourceKey),
        ),
      );
  },

  /** UPLOADING → FAILED with the reason; the rejected object itself is deleted by the caller */
  markRejected: async (
    episodeId: number,
    sourceKey: string,
    reason: string,
    audit: AuditContext,
  ) => {
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(episodes)
        .where(eq(episodes.id, episodeId))
        .for("update");
      if (before?.videoStatus !== "UPLOADING" || before.videoSourceKey !== sourceKey) return;

      const [after] = await tx
        .update(episodes)
        .set({ videoStatus: "FAILED", videoSourceKey: null, videoError: reason })
        .where(eq(episodes.id, episodeId))
        .returning();
      if (!after) throw new Error("Update of episodes returned no rows");

      await AuditRepository.record(tx, {
        ...audit,
        action: "video.rejected",
        entityType: "episode",
        entityId: episodeId,
        changes: diffFields(videoFields(before), videoFields(after)),
      });
    });
  },
};
