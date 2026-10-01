import { sql } from "drizzle-orm";
import { fromDrizzle, type PgBoss, type SendOptions } from "pg-boss";
import type { Transaction } from "@/database";
import { logger } from "@/shared/logger";
import { createBoss, type QueueRole } from "./connection";

/** Job queue on PostgreSQL (pg-boss) — why not BullMQ/Redis: docs/adr/0002-video-pipeline-infrastructure.md */
export const QUEUES = {
  transcode: "video.transcode",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobData {
  "video.transcode": { episodeId: number; sourceKey: string };
}

type QueueOptions = NonNullable<Parameters<PgBoss["createQueue"]>[1]>;

const QUEUE_OPTIONS: Record<QueueName, QueueOptions> = {
  [QUEUES.transcode]: {
    retryLimit: 2,
    retryDelay: 30,
    retryBackoff: true,
    // A long episode on a slow machine takes a while; past this the attempt is considered lost
    expireInSeconds: 2 * 60 * 60,
  },
};

let started: Promise<PgBoss> | undefined;

/** Starts once per process. The API and the worker may start at the same moment: all steps are idempotent */
export function startJobQueue(role: QueueRole = "producer"): Promise<PgBoss> {
  started ??= (async () => {
    const boss = createBoss(role);
    boss.on("error", (error) => logger.error({ err: error }, "job queue error"));
    await boss.start();
    for (const [name, options] of Object.entries(QUEUE_OPTIONS)) {
      await boss.createQueue(name, options);
    }
    return boss;
  })().catch((error) => {
    // Let the next call try again instead of caching the failure forever
    started = undefined;
    throw error;
  });

  return started;
}

/**
 * Enqueues a job as part of OUR transaction: if the transaction rolls back, the job is gone too.
 * This is the reason for a PostgreSQL queue (a Redis queue would keep an orphan job).
 */
export async function enqueue<Q extends QueueName>(
  tx: Transaction,
  queue: Q,
  data: JobData[Q],
  options?: SendOptions,
) {
  const boss = await startJobQueue();
  return await boss.send(queue, data, { ...options, db: fromDrizzle(tx, sql) });
}

export async function stopJobQueue() {
  if (!started) return;
  const boss = await started;
  started = undefined;
  // graceful: running jobs finish within the timeout, no new ones are fetched
  await boss.stop({ graceful: true, timeout: 25_000 });
}
