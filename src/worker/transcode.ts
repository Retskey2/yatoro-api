import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { JobWithMetadata } from "pg-boss";
import { db } from "@/database";
import { episodes } from "@/database/schema";
import {
  buildLadder,
  buildTranscodeArgs,
  contentTypeFor,
  progressFromLine,
} from "@/modules/video/hls";
import { storageKeys } from "@/modules/video/video.model";
import { VideoRepository } from "@/modules/video/video.repository";
import type { JobData } from "@/queue";
import { logger } from "@/shared/logger";
import { requireStorage } from "@/shared/storage";

/** Runs a command; stdout is streamed line by line to `onLine`. Throws with the tail of stderr */
async function run(command: string[], signal: AbortSignal, onLine?: (line: string) => void) {
  const process = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", signal });
  const decoder = new TextDecoder();
  let stdout = "";
  let pending = "";

  for await (const chunk of process.stdout) {
    const text = decoder.decode(chunk, { stream: true });
    stdout += text;
    if (onLine) {
      pending += text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) onLine(line);
    }
  }

  const stderr = await new Response(process.stderr).text();
  const code = await process.exited;
  if (code !== 0) {
    throw new Error(`${command[0]} exited with ${code}: ${stderr.trim().slice(-400)}`);
  }
  return stdout;
}

async function probe(path: string, signal: AbortSignal) {
  const output = await run(
    [
      "ffprobe",
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_entries",
      "stream=codec_type,height:format=duration",
      path,
    ],
    signal,
  );
  const info = JSON.parse(output) as {
    streams?: { codec_type?: string; height?: number }[];
    format?: { duration?: string };
  };

  const video = info.streams?.find((stream) => stream.codec_type === "video");
  if (!video?.height) throw new Error("В файле нет видеодорожки");

  return {
    height: video.height,
    durationSec: Number(info.format?.duration ?? 0),
    hasAudio: info.streams?.some((stream) => stream.codec_type === "audio") ?? false,
  };
}

/**
 * source in storage → ffmpeg (HLS ladder + poster) → a new HLS version in storage → READY.
 * Safe to retry: every attempt works in its own temp dir and its own storage prefix.
 */
export async function handleTranscode(job: JobWithMetadata<JobData["video.transcode"]>) {
  const { episodeId, sourceKey } = job.data;
  const storage = requireStorage();

  // The upload may have been replaced or the episode deleted since the job was queued
  const [episode] = await db
    .select({ status: episodes.videoStatus, sourceKey: episodes.videoSourceKey })
    .from(episodes)
    .where(eq(episodes.id, episodeId));
  if (episode?.status !== "PROCESSING" || episode.sourceKey !== sourceKey) {
    logger.info({ jobId: job.id, episodeId }, "stale transcode job skipped");
    return;
  }

  const workDir = await mkdtemp(join(tmpdir(), `transcode-${episodeId}-`));
  let hlsPrefix: string | undefined;
  const startedAt = performance.now();

  try {
    const input = join(workDir, "source");
    const outDir = join(workDir, "hls");
    await storage.downloadTo(sourceKey, input);

    const info = await probe(input, job.signal);
    const ladder = buildLadder(info.height);

    // Progress goes to the database at most once a second and in steps of ≥ 5%
    let reported = 0;
    let reportedAt = 0;
    await run(
      buildTranscodeArgs({ input, outDir, ladder, hasAudio: info.hasAudio }),
      job.signal,
      (line) => {
        const percent = progressFromLine(line, info.durationSec);
        if (percent === null || percent < reported + 5 || Date.now() - reportedAt < 1000) return;
        reported = percent;
        reportedAt = Date.now();
        void VideoRepository.setProgress(episodeId, sourceKey, percent).catch(() => {});
      },
    );

    await run(
      [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        Math.min(info.durationSec * 0.1, 10).toFixed(2),
        "-i",
        input,
        "-frames:v",
        "1",
        "-vf",
        "scale=640:-2",
        join(outDir, "poster.jpg"),
      ],
      job.signal,
    );

    hlsPrefix = storageKeys.hls(episodeId);
    const files = await Array.fromAsync(
      new Bun.Glob("**/*").scan({ cwd: outDir, onlyFiles: true }),
    );
    // Playlists last: a playlist never points to a segment that is not uploaded yet
    files.sort((a, b) => Number(a.endsWith(".m3u8")) - Number(b.endsWith(".m3u8")));
    for (const file of files) {
      const relative = file.replaceAll("\\", "/");
      await storage.write(
        `${hlsPrefix}${relative}`,
        Bun.file(join(outDir, file)),
        contentTypeFor(file),
      );
    }

    const ready = await VideoRepository.markReady(episodeId, sourceKey, {
      hlsPrefix,
      durationSec: info.durationSec,
    });
    if (!ready) {
      // Replaced while we were working: what we produced belongs to nobody
      await storage.deletePrefix(hlsPrefix);
      logger.info({ jobId: job.id, episodeId }, "transcode result discarded: upload was replaced");
      return;
    }

    logger.info(
      {
        jobId: job.id,
        episodeId,
        renditions: ladder.map((rendition) => rendition.name),
        durationSec: info.durationSec,
        files: files.length,
        // How fast compared with real time, e.g. 8 → one minute of video in 7.5 s
        speed: Number((info.durationSec / ((performance.now() - startedAt) / 1000)).toFixed(2)),
      },
      "transcode done",
    );
  } catch (error) {
    if (hlsPrefix) await storage.deletePrefix(hlsPrefix).catch(() => {});
    if (job.retryCount >= job.retryLimit) {
      await VideoRepository.markFailed(episodeId, sourceKey, (error as Error).message);
    }
    throw error;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
