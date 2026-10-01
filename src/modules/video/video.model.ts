import { t } from "elysia";

/** A single presigned PUT is limited to 5 GiB by S3 (multipart is the upgrade path, see ADR 0002) */
export const MAX_SOURCE_BYTES = 5 * 1024 ** 3;
export const UPLOAD_URL_TTL_SECONDS = 60 * 60;

/** Bytes read from the uploaded object to detect its real type (file-type needs ≤ 4100) */
export const SNIFF_BYTES = 4100;

/**
 * Accepted containers, by the type detected from the file's content.
 * ffmpeg can read more, but these are what people actually upload.
 */
export const ACCEPTED_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/matroska",
  "video/quicktime",
] as const;

export const RequestUploadBody = t.Object({
  // The content type is not asked for: the presigned URL cannot enforce it anyway,
  // the real type is detected from the uploaded bytes on completion
  size: t.Integer({ minimum: 1, maximum: MAX_SOURCE_BYTES }),
});

export const UploadTicket = t.Object({
  uploadUrl: t.String(),
  method: t.Literal("PUT"),
  expiresAt: t.Date(),
  maxSize: t.Integer(),
});

/** Storage layout: everything of an episode lives under one prefix, so deleting it is one sweep */
export const storageKeys = {
  episodePrefix: (episodeId: number) => `episodes/${episodeId}/`,
  source: (episodeId: number) => `episodes/${episodeId}/source/${Bun.randomUUIDv7()}`,
};
