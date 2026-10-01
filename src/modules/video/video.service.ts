import { fileTypeFromBuffer } from "file-type";
import { toEpisode } from "@/modules/anime/anime.model";
import type { AuditContext } from "@/modules/audit/audit.repository";
import { BadRequestError, ConflictError, NotFoundError } from "@/shared/errors";
import { requireStorage } from "@/shared/storage";
import { signPlaylist } from "./hls";
import {
  ACCEPTED_VIDEO_TYPES,
  MAX_SOURCE_BYTES,
  PLAYBACK_URL_TTL_SECONDS,
  SNIFF_BYTES,
  storageKeys,
  UPLOAD_URL_TTL_SECONDS,
} from "./video.model";
import { VideoRepository } from "./video.repository";

/**
 * Upload flow (docs/adr/0002-video-pipeline-infrastructure.md):
 *   1. requestUpload  → the episode is UPLOADING, the admin gets a presigned PUT URL
 *   2. the browser uploads straight to the storage — the API never sees the bytes
 *   3. completeUpload → the object is verified, the episode is PROCESSING, a transcode job is queued
 */
export class VideoService {
  /** `_size` is validated by the route schema (≤ MAX_SOURCE_BYTES); the real size is checked on completion */
  async requestUpload(animeId: number, number: number, _size: number, audit: AuditContext) {
    const storage = requireStorage();

    const episode = await VideoRepository.find(animeId, number);
    if (!episode) throw new NotFoundError(`Серия ${number} не найдена`);

    const sourceKey = storageKeys.source(episode.id);
    const result = await VideoRepository.startUpload(episode.id, sourceKey, audit);
    if (result.kind === "not_found") throw new NotFoundError(`Серия ${number} не найдена`);
    if (result.kind === "busy") {
      throw new ConflictError("Видео этой серии ещё обрабатывается — дождитесь окончания");
    }

    return {
      uploadUrl: storage.presignUpload(sourceKey, UPLOAD_URL_TTL_SECONDS),
      method: "PUT" as const,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
      maxSize: MAX_SOURCE_BYTES,
    };
  }

  async completeUpload(animeId: number, number: number, audit: AuditContext) {
    const storage = requireStorage();

    const episode = await VideoRepository.find(animeId, number);
    if (!episode) throw new NotFoundError(`Серия ${number} не найдена`);
    if (episode.videoStatus !== "UPLOADING" || !episode.videoSourceKey) {
      throw new ConflictError("Для этой серии нет начатой загрузки");
    }
    const sourceKey = episode.videoSourceKey;

    // The presigned URL does not restrict what gets uploaded: verify the object itself
    const object = await storage.stat(sourceKey);
    if (!object) throw new ConflictError("Файл ещё не загружен в хранилище");

    const problem = await this.findProblem(sourceKey, object.size);
    if (problem) {
      await storage.delete(sourceKey);
      await VideoRepository.markRejected(episode.id, sourceKey, problem, audit);
      throw new BadRequestError(problem);
    }

    const updated = await VideoRepository.markUploaded(episode.id, sourceKey, audit);
    if (!updated) {
      throw new ConflictError("Загрузка была перезапущена или уже завершена — обновите данные");
    }

    return toEpisode(updated);
  }

  /** The master playlist as produced by ffmpeg: it references renditions by relative paths */
  async masterPlaylist(animeId: number, number: number) {
    const { prefix } = await this.readyVideo(animeId, number);
    const playlist = await requireStorage().readText(`${prefix}master.m3u8`);
    if (!playlist) throw new NotFoundError("Видео серии не найдено в хранилище");
    return playlist;
  }

  /**
   * A rendition playlist with every segment (and the fMP4 init segment) replaced by a presigned
   * URL: the bucket stays private, the bytes go from the storage straight to the player.
   */
  async renditionPlaylist(animeId: number, number: number, rendition: string) {
    const { prefix } = await this.readyVideo(animeId, number);
    const storage = requireStorage();
    const playlist = await storage.readText(`${prefix}${rendition}/index.m3u8`);
    if (!playlist) throw new NotFoundError(`Качество ${rendition} не найдено`);

    return signPlaylist(playlist, (path) =>
      storage.presignDownload(`${prefix}${rendition}/${path}`, PLAYBACK_URL_TTL_SECONDS),
    );
  }

  private async readyVideo(animeId: number, number: number) {
    const episode = await VideoRepository.find(animeId, number);
    if (episode?.videoStatus !== "READY" || !episode.videoHlsPrefix) {
      throw new NotFoundError("Видео этой серии ещё не готово");
    }
    return { prefix: episode.videoHlsPrefix };
  }

  private async findProblem(sourceKey: string, size: number): Promise<string | null> {
    if (size > MAX_SOURCE_BYTES) return "Файл больше 5 ГБ";

    const head = await requireStorage().readHead(sourceKey, SNIFF_BYTES);
    const detected = await fileTypeFromBuffer(head);
    const accepted: readonly string[] = ACCEPTED_VIDEO_TYPES;

    return detected && accepted.includes(detected.mime)
      ? null
      : `Файл не является видео поддерживаемого формата (mp4, webm, mkv, mov)${
          detected ? `: определён как ${detected.mime}` : ""
        }`;
  }
}
