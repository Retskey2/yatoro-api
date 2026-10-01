/**
 * End-to-end check of the video upload flow against a running `docker compose` stack:
 * real HTTP, real presigned upload to SeaweedFS, real queue and worker.
 *
 *   docker compose up -d --build --wait && bun scripts/e2e-video.ts
 */
import { join } from "node:path";

const API = process.env.API_URL ?? "http://localhost:5084";
const ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? "admin@yatoro.local",
  password: process.env.SEED_ADMIN_PASSWORD ?? "change-me-admin-password",
};
// The same local-only credentials as docker-compose.yml / docker/seaweedfs/s3.json
const s3 = new Bun.S3Client({
  endpoint: "http://localhost:9000",
  bucket: "yatoro-media",
  region: "us-east-1",
  accessKeyId: "yatoro-dev",
  secretAccessKey: "yatoro-dev-secret-change-me",
});

let step = 0;
function check(condition: unknown, message: string): asserts condition {
  step++;
  if (!condition) {
    console.error(`❌ ${step}. ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${step}. ${message}`);
}

async function call<T>(method: string, path: string, body?: unknown, token?: string) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
}

async function waitFor(what: string, probe: () => Promise<boolean>, seconds = 30) {
  for (let i = 0; i < seconds; i++) {
    if (await probe()) return true;
    await Bun.sleep(1000);
  }
  throw new Error(`timeout waiting for ${what}`);
}

type Ticket = { uploadUrl: string };
type EpisodeResponse = {
  id: number;
  number: number;
  video: {
    status: string;
    progress: number;
    durationSec: number | null;
    error: string | null;
    playbackUrl: string | null;
    posterUrl: string | null;
  };
};

const login = await call<{ accessToken: string }>("POST", "/api/auth/login", ADMIN);
check(login.status === 200, "admin logs in");
const token = login.data.accessToken;

// A fresh anime, so the script can run any number of times
const anime = await call<{ id: number }>(
  "POST",
  "/api/anime",
  { title: `E2E ${Date.now()}` },
  token,
);
check(anime.status === 201, "admin creates an anime");
const episodesPath = `/api/anime/${anime.data.id}/episodes`;
for (const number of [1, 2]) await call("POST", episodesPath, { number }, token);

// --- happy path: a real video through a presigned URL ---
// E2E_SOURCE: any local video (e.g. a 720p clip to see the full ladder); the 1 s fixture by default
const mp4 = await Bun.file(
  process.env.E2E_SOURCE ?? join(import.meta.dir, "../tests/fixtures/video/sample.mp4"),
).bytes();
const ticket = await call<Ticket>(
  "POST",
  `${episodesPath}/1/video/upload`,
  { size: mp4.length },
  token,
);
check(ticket.status === 201, "upload URL issued");

const put = await fetch(ticket.data.uploadUrl, { method: "PUT", body: mp4 });
check(put.ok, `the browser-style PUT goes straight to SeaweedFS (HTTP ${put.status})`);

const done = await call<EpisodeResponse>(
  "POST",
  `${episodesPath}/1/video/complete`,
  undefined,
  token,
);
check(done.status === 200 && done.data.video.status === "PROCESSING", "episode is PROCESSING");

const sourceKey = decodeURIComponent(new URL(ticket.data.uploadUrl).pathname).replace(
  /^\/yatoro-media\//,
  "",
);
check(await s3.exists(sourceKey), `source stored at ${sourceKey}`);

// --- the worker transcodes it to HLS ---
const startedAt = performance.now();
let video: EpisodeResponse["video"] | undefined;
await waitFor(
  "the worker to transcode",
  async () => {
    const { data } = await call<{ episodes: EpisodeResponse[] }>(
      "GET",
      `/api/anime/${anime.data.id}`,
    );
    video = data.episodes.find((episode) => episode.number === 1)?.video;
    if (video?.status === "FAILED") throw new Error(`transcode failed: ${video.error}`);
    return video?.status === "READY";
  },
  300,
);
const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
check(
  video?.status === "READY" && video.progress === 100,
  `READY in ${seconds} s (${video?.durationSec?.toFixed(1)} s of video)`,
);

// --- and a player can play it: the same requests hls.js makes ---
const masterResponse = await fetch(`${API}${video?.playbackUrl}`);
const master = await masterResponse.text();
const renditions = master.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
check(
  masterResponse.headers.get("content-type") === "application/vnd.apple.mpegurl" &&
    renditions.length > 0,
  `master playlist: ${renditions.map((path) => path.split("/")[0]).join(", ")}`,
);

const renditionUrl = new URL(renditions[0] ?? "", `${API}${video?.playbackUrl}`);
const playlist = await (await fetch(renditionUrl)).text();
const initUrl = /URI="([^"]+)"/.exec(playlist)?.[1] ?? "";
const segmentUrl = playlist.split(/\r?\n/).find((line) => line.startsWith("http")) ?? "";
check(
  initUrl.startsWith("http://localhost:9000/") && segmentUrl.startsWith("http://localhost:9000/"),
  "rendition playlist points to signed storage URLs (init + segments)",
);

const init = await fetch(initUrl);
const segment = await fetch(segmentUrl);
check(
  init.ok && segment.ok && (await segment.arrayBuffer()).byteLength > 0,
  "init segment and media segment download straight from the storage",
);

const poster = await fetch(video?.posterUrl ?? "");
check(poster.ok && (await poster.arrayBuffer()).byteLength > 0, "poster is available");

// --- a non-video under a video URL is rejected and removed ---
const bad = await call<Ticket>("POST", `${episodesPath}/2/video/upload`, { size: 30 }, token);
await fetch(bad.data.uploadUrl, { method: "PUT", body: "<script>alert(1)</script>" });
const badKey = decodeURIComponent(new URL(bad.data.uploadUrl).pathname).replace(
  /^\/yatoro-media\//,
  "",
);
const rejected = await call<{ error: { message: string } }>(
  "POST",
  `${episodesPath}/2/video/complete`,
  undefined,
  token,
);
check(
  rejected.status === 400,
  `HTML disguised as video is rejected: ${rejected.data.error.message}`,
);
check(!(await s3.exists(badKey)), "the rejected object is deleted from the storage");

// --- deleting an episode removes its files (through the queue and the worker) ---
const deleted = await call("DELETE", `${episodesPath}/1`, undefined, token);
check(deleted.status === 204, "episode deleted");
await waitFor("the worker to clean up", async () => !(await s3.exists(sourceKey)));
const leftovers = await s3.list({ prefix: sourceKey.split("/source/")[0] });
check(
  (leftovers.contents ?? []).length === 0,
  "the worker deleted the episode's files (source and HLS) from the storage",
);

await call("DELETE", `/api/anime/${anime.data.id}`, undefined, token);
console.log(`\n🎉 video upload flow works end to end (${step} checks)`);
