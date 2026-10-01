/**
 * HLS building blocks shared by the worker (producing) and the API (serving).
 * Pure functions on purpose: they are unit-tested without ffmpeg.
 */

export interface Rendition {
  name: string;
  height: number;
  /** Video bitrate, kbit/s */
  bitrate: number;
}

/** Common VOD ladder (H.264). The audio adds 128 kbit/s to each rendition */
export const RENDITIONS: Rendition[] = [
  { name: "360p", height: 360, bitrate: 800 },
  { name: "720p", height: 720, bitrate: 2800 },
  { name: "1080p", height: 1080, bitrate: 5000 },
];

export const SEGMENT_SECONDS = 6;

/** Never upscale: renditions up to the source height; a tiny source gets one rendition of its own size */
export function buildLadder(sourceHeight: number): Rendition[] {
  const ladder = RENDITIONS.filter((rendition) => rendition.height <= sourceHeight);
  if (ladder.length > 0) return ladder;

  const height = Math.max(2, sourceHeight - (sourceHeight % 2));
  return [{ name: `${height}p`, height, bitrate: 400 }];
}

/**
 * One ffmpeg run for the whole ladder: the source is decoded once, scaled per rendition,
 * encoded to fMP4 segments with a master playlist. Keyframes are forced every SEGMENT_SECONDS
 * in every rendition, so segment boundaries line up and the player can switch quality anywhere.
 */
export function buildTranscodeArgs(options: {
  input: string;
  outDir: string;
  ladder: Rendition[];
  hasAudio: boolean;
}): string[] {
  const { input, outDir, ladder, hasAudio } = options;
  const n = ladder.length;

  const split = `[0:v]split=${n}${ladder.map((_, i) => `[v${i}]`).join("")}`;
  const scales = ladder.map((rendition, i) => `[v${i}]scale=-2:${rendition.height}[v${i}o]`);

  const maps = ladder.flatMap((_, i) => [
    "-map",
    `[v${i}o]`,
    ...(hasAudio ? ["-map", "0:a:0"] : []),
  ]);

  const bitrates = ladder.flatMap((rendition, i) => [
    `-b:v:${i}`,
    `${rendition.bitrate}k`,
    `-maxrate:v:${i}`,
    `${Math.round(rendition.bitrate * 1.07)}k`,
    `-bufsize:v:${i}`,
    `${Math.round(rendition.bitrate * 1.5)}k`,
  ]);

  const streamMap = ladder
    .map((rendition, i) => `v:${i}${hasAudio ? `,a:${i}` : ""},name:${rendition.name}`)
    .join(" ");

  return [
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-filter_complex",
    [split, ...scales].join(";"),
    ...maps,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-force_key_frames",
    `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
    ...bitrates,
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "128k", "-ac", "2"] : []),
    "-f",
    "hls",
    "-hls_time",
    String(SEGMENT_SECONDS),
    "-hls_playlist_type",
    "vod",
    "-hls_segment_type",
    "fmp4",
    "-hls_flags",
    "independent_segments",
    "-hls_fmp4_init_filename",
    "init.mp4",
    "-hls_segment_filename",
    `${outDir}/%v/seg_%03d.m4s`,
    "-master_pl_name",
    "master.m3u8",
    "-var_stream_map",
    streamMap,
    "-progress",
    "pipe:1",
    "-nostats",
    `${outDir}/%v/index.m3u8`,
  ];
}

/** `out_time_us=…` from `ffmpeg -progress` → percent (0..99; 100 is set when everything is uploaded) */
export function progressFromLine(line: string, durationSec: number): number | null {
  const match = /^out_time_us=(\d+)$/.exec(line.trim());
  if (!match?.[1] || durationSec <= 0) return null;
  const percent = Math.floor((Number(match[1]) / 1_000_000 / durationSec) * 100);
  return Math.max(0, Math.min(99, percent));
}

/**
 * Rewrites a rendition playlist so every file it references — segments AND the fMP4 init
 * segment in `#EXT-X-MAP:URI="…"` (easy to miss, the player won't start without it) —
 * points to a presigned URL. Comments and tags stay as they are.
 */
export function signPlaylist(playlist: string, sign: (relativePath: string) => string): string {
  return playlist
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("#EXT-X-MAP:")) {
        return trimmed.replace(/URI="([^"]+)"/, (_, uri: string) => `URI="${sign(uri)}"`);
      }
      return trimmed && !trimmed.startsWith("#") ? sign(trimmed) : line;
    })
    .join("\n");
}

const CONTENT_TYPES: Record<string, string> = {
  m3u8: "application/vnd.apple.mpegurl",
  m4s: "video/iso.segment",
  mp4: "video/mp4",
  jpg: "image/jpeg",
};

export const contentTypeFor = (path: string) =>
  CONTENT_TYPES[path.split(".").at(-1) ?? ""] ?? "application/octet-stream";

/** Rendition names come from our ladder; anything else in a URL is rejected */
export const RENDITION_PATTERN = "^[0-9]{2,4}p$";
