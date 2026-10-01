import type { Transaction } from "@/database";
import { enqueue, QUEUES } from "@/queue";
import { getStorage } from "@/shared/storage";
import { storageKeys } from "./video.model";

/**
 * Schedules deletion of everything an episode has in the storage (source, HLS renditions).
 * Called inside the transaction that deletes the episodes: if it rolls back, nothing is deleted;
 * if it commits, the files cannot be forgotten. No storage configured → no files to delete.
 */
export async function scheduleEpisodeFilesCleanup(tx: Transaction, episodeIds: number[]) {
  if (!getStorage() || episodeIds.length === 0) return;
  await enqueue(tx, QUEUES.cleanup, { prefixes: episodeIds.map(storageKeys.episodePrefix) });
}
