/**
 * Background worker: runs jobs from the PostgreSQL queue (pg-boss).
 *
 *   bun run worker        # locally (needs ffmpeg in PATH)
 *   docker compose up     # the `worker` container ships with ffmpeg
 */
import { client } from "@/database";
import { type JobData, QUEUES, startJobQueue, stopJobQueue } from "@/queue";
import { logger } from "@/shared/logger";
import { requireStorage } from "@/shared/storage";
import { handleTranscode } from "./transcode";

function ffmpegVersion(): string | null {
  try {
    const result = Bun.spawnSync(["ffmpeg", "-version"]);
    return result.success ? (result.stdout.toString().split("\n")[0] ?? null) : null;
  } catch {
    return null;
  }
}

const ffmpeg = ffmpegVersion();
if (!ffmpeg) {
  logger.fatal("ffmpeg не найден в PATH: установите его или запустите воркер через docker compose");
  process.exit(1);
}

const boss = await startJobQueue("worker");

// One transcode at a time per worker: ffmpeg already uses every core.
// includeMetadata: the handler needs retryLimit to tell the last attempt
const transcodeOptions = { pollingIntervalSeconds: 2, includeMetadata: true } as const;
await boss.work<JobData["video.transcode"], void, typeof transcodeOptions>(
  QUEUES.transcode,
  transcodeOptions,
  async ([job]) => {
    if (job) await handleTranscode(job);
  },
);

await boss.work<JobData["storage.cleanup"]>(QUEUES.cleanup, async ([job]) => {
  if (!job) return;
  // Idempotent: deleting an already deleted object or an empty prefix is not an error
  const storage = requireStorage();
  for (const key of job.data.keys ?? []) await storage.delete(key);
  let deleted = job.data.keys?.length ?? 0;
  for (const prefix of job.data.prefixes ?? []) deleted += await storage.deletePrefix(prefix);
  logger.info({ jobId: job.id, ...job.data, deleted }, "storage cleanup done");
});

logger.info({ ffmpeg }, "🎬 worker ready");

async function shutdown(signal: NodeJS.Signals) {
  logger.info(`${signal}: останавливаю воркер`);

  const forceExit = setTimeout(() => {
    logger.error("Воркер не остановился за 30 с, выхожу принудительно");
    process.exit(1);
  }, 30_000);

  // Graceful: running jobs finish, no new ones are taken
  await stopJobQueue();
  await client.end({ timeout: 5 });

  clearTimeout(forceExit);
  logger.info("Воркер остановлен");
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void shutdown(signal));
}
