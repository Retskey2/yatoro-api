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

await boss.work(QUEUES.transcode, { pollingIntervalSeconds: 2 }, async ([job]) => {
  // Phase 4.4: download the source, ffmpeg → HLS ladder, upload, mark the episode READY.
  // Until then fail loudly: a job must never be marked done without being processed.
  logger.warn({ jobId: job?.id, data: job?.data }, "transcode handler is not implemented yet");
  throw new Error("Transcoding is not implemented yet");
});

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
