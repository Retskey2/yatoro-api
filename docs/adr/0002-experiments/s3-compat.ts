// S3 compatibility check of MinIO replacements for the HLS pipeline
import { CreateBucketCommand, PutBucketCorsCommand, S3Client as AwsS3 } from "@aws-sdk/client-s3";

const servers = [
  { name: "rustfs", endpoint: "http://127.0.0.1:9200", key: "rustfs", secret: "rustfs-secret-123" },
  { name: "seaweedfs", endpoint: "http://127.0.0.1:9300", key: "seaweed", secret: "seaweed-secret-123" },
];

const bucket = "yatoro-test";
const origin = "http://localhost:3000";

async function check(name: string, fn: () => Promise<string>) {
  try {
    return `✅ ${await fn()}`;
  } catch (error) {
    return `❌ ${(error as Error).message.slice(0, 80)}`;
  }
}

for (const server of servers) {
  const aws = new AwsS3({
    endpoint: server.endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: server.key, secretAccessKey: server.secret },
  });
  const s3 = new Bun.S3Client({
    endpoint: server.endpoint,
    accessKeyId: server.key,
    secretAccessKey: server.secret,
    bucket,
    region: "us-east-1",
  });

  const results: Record<string, string> = {};

  results["create bucket (aws sdk)"] = await check("bucket", async () => {
    try {
      await aws.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (error) {
      if (!/BucketAlready/.test((error as Error).name)) throw error;
    }
    return "ok";
  });

  results["put bucket CORS (aws sdk)"] = await check("cors", async () => {
    await aws.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: [origin],
              AllowedMethods: ["PUT", "GET", "HEAD"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 600,
            },
          ],
        },
      }),
    );
    return "ok";
  });

  results["Bun.S3Client write/read"] = await check("rw", async () => {
    await s3.write("hello.txt", "привет, s3");
    const text = await s3.file("hello.txt").text();
    if (text !== "привет, s3") throw new Error(`got ${text}`);
    return "ok";
  });

  const payload = new Uint8Array(1024 * 1024).map((_, i) => i % 251);

  results["presigned PUT (Bun)"] = await check("put", async () => {
    const url = s3.presign("upload.bin", { method: "PUT", expiresIn: 600, type: "video/mp4" });
    const res = await fetch(url, { method: "PUT", body: payload, headers: { "content-type": "video/mp4" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 60)}`);
    return `HTTP ${res.status}`;
  });

  results["presigned GET + Range (Bun)"] = await check("get", async () => {
    const url = s3.presign("upload.bin", { method: "GET", expiresIn: 600 });
    const full = await fetch(url);
    const body = new Uint8Array(await full.arrayBuffer());
    const ranged = await fetch(url, { headers: { range: "bytes=100-199" } });
    const part = new Uint8Array(await ranged.arrayBuffer());
    if (body.length !== payload.length) throw new Error(`size ${body.length}`);
    if (ranged.status !== 206 || part.length !== 100 || part[0] !== payload[100]) {
      throw new Error(`range: HTTP ${ranged.status}, ${part.length} bytes`);
    }
    return "full + 206 partial";
  });

  results["browser CORS preflight"] = await check("preflight", async () => {
    const url = s3.presign("browser.bin", { method: "PUT", expiresIn: 600 });
    const res = await fetch(url, {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type",
      },
    });
    const allowed = res.headers.get("access-control-allow-origin");
    if (!res.ok || !allowed) throw new Error(`HTTP ${res.status}, allow-origin=${allowed}`);
    return `HTTP ${res.status}, allow-origin=${allowed}`;
  });

  results["server-side multipart (Bun writer, 16 MiB)"] = await check("multipart", async () => {
    const writer = s3.file("big.bin").writer({ partSize: 5 * 1024 * 1024, queueSize: 2 });
    const chunk = new Uint8Array(1024 * 1024).fill(7);
    for (let i = 0; i < 16; i++) writer.write(chunk);
    await writer.end();
    const size = (await s3.file("big.bin").stat()).size;
    if (size !== 16 * 1024 * 1024) throw new Error(`size ${size}`);
    return `${size / 1024 / 1024} MiB`;
  });

  results["presign speed"] = await check("speed", async () => {
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) s3.presign(`hls/ep1/720p/seg-${i}.m4s`, { expiresIn: 3600 });
    const perUrl = ((performance.now() - start) * 1000) / 10_000;
    return `${perUrl.toFixed(1)} µs per URL`;
  });

  console.log(`\n=== ${server.name}`);
  console.table(results);
}
