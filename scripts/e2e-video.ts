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
type EpisodeResponse = { id: number; video: { status: string; error: string | null } };

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
const mp4 = await Bun.file(join(import.meta.dir, "../tests/fixtures/video/sample.mp4")).bytes();
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
check(true, "the worker deleted the episode's files from the storage");

await call("DELETE", `/api/anime/${anime.data.id}`, undefined, token);
console.log(`\n🎉 video upload flow works end to end (${step} checks)`);
