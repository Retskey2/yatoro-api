import {
  S3Client as AwsS3Client,
  type CORSRule,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { env } from "@/config/env";
import { ServiceUnavailableError } from "./errors";
import { logger } from "./logger";

/**
 * What the video pipeline needs from S3-compatible object storage
 * (see docs/adr/0002-video-pipeline-infrastructure.md). Kept small on purpose:
 * tests swap in an in-memory fake through `setStorage`.
 */
export interface ObjectStorage {
  /**
   * A URL a browser can PUT the file to. The signature covers only the host and the key:
   * the content type and size are NOT enforced, so the uploaded object must be verified.
   */
  presignUpload(key: string, expiresInSeconds: number): string;
  presignDownload(key: string, expiresInSeconds: number): string;
  /** `null` if the object does not exist */
  stat(key: string): Promise<{ size: number } | null>;
  /** The first bytes of the object (ranged GET) — enough to detect the real file type */
  readHead(key: string, bytes: number): Promise<Uint8Array>;
  /** Whole object as text (HLS playlists); `null` if it does not exist */
  readText(key: string): Promise<string | null>;
  /** Streams the object to a local file (the worker reads sources this way) */
  downloadTo(key: string, path: string): Promise<void>;
  write(key: string, data: Blob | Uint8Array | string, contentType?: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** Deletes every object under the prefix and returns how many were deleted */
  deletePrefix(prefix: string): Promise<number>;
  ping(): Promise<boolean>;
}

/**
 * Two clients on purpose: inside Docker the API reaches the storage as `seaweedfs:8333`,
 * while browsers reach it as `localhost:9000`. The host is part of a presigned URL's signature,
 * so URLs handed to browsers are signed by `browser`; everything server-side goes through `internal`.
 */
class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly internal: Bun.S3Client,
    private readonly browser: Bun.S3Client,
  ) {}

  presignUpload(key: string, expiresInSeconds: number) {
    return this.browser.presign(key, { method: "PUT", expiresIn: expiresInSeconds });
  }

  presignDownload(key: string, expiresInSeconds: number) {
    return this.browser.presign(key, { method: "GET", expiresIn: expiresInSeconds });
  }

  async stat(key: string) {
    try {
      const { size } = await this.internal.stat(key);
      return { size };
    } catch (error) {
      if ((error as { code?: string }).code === "NoSuchKey") return null;
      throw error;
    }
  }

  async readHead(key: string, bytes: number) {
    return new Uint8Array(await this.internal.file(key).slice(0, bytes).arrayBuffer());
  }

  async readText(key: string) {
    try {
      return await this.internal.file(key).text();
    } catch (error) {
      if ((error as { code?: string }).code === "NoSuchKey") return null;
      throw error;
    }
  }

  async downloadTo(key: string, path: string) {
    await Bun.write(path, this.internal.file(key));
  }

  async write(key: string, data: Blob | Uint8Array | string, contentType?: string) {
    await this.internal.write(key, data, contentType ? { type: contentType } : undefined);
  }

  async delete(key: string) {
    await this.internal.delete(key);
  }

  async deletePrefix(prefix: string) {
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
      const page = await this.internal.list({ prefix, continuationToken, maxKeys: 1000 });
      const keys = (page.contents ?? []).map((object) => object.key);
      await Promise.all(keys.map((key) => this.internal.delete(key)));
      deleted += keys.length;
      continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
    } while (continuationToken);

    return deleted;
  }

  async ping() {
    return await this.internal.list({ maxKeys: 1 }).then(
      () => true,
      () => false,
    );
  }
}

function createStorage(): ObjectStorage | null {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null;

  const client = (endpoint: string) =>
    new Bun.S3Client({
      endpoint,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });

  return new S3ObjectStorage(
    client(env.S3_ENDPOINT),
    client(env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT),
  );
}

let current = createStorage();

export const getStorage = (): ObjectStorage | null => current;

/** Tests swap in an in-memory fake (and back to `null`) */
export function setStorage(next: ObjectStorage | null) {
  current = next;
}

export function requireStorage(): ObjectStorage {
  if (!current) {
    throw new ServiceUnavailableError("Хранилище файлов не настроено (S3_ENDPOINT)");
  }
  return current;
}

/** `true` if the bucket answers within the timeout; `null` if storage is not configured */
export async function isStorageReachable(timeoutMs = 2_000): Promise<boolean | null> {
  if (!current) return null;

  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  return await Promise.race([current.ping(), timeout]);
}

/** Browsers upload straight to the bucket, so it must allow our frontends' origins */
export function bucketCorsRules(origins: string[]): CORSRule[] {
  return [
    {
      AllowedOrigins: origins,
      AllowedMethods: ["GET", "HEAD", "PUT"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600,
    },
  ];
}

/**
 * Creates the bucket if needed and (re)applies CORS. Idempotent, runs on API start.
 * Bun.S3Client has no bucket-level operations, so this is the only use of the AWS SDK.
 */
export async function ensureBucket(
  origins: string[],
  { attempts = 10, delayMs = 1_000 }: { attempts?: number; delayMs?: number } = {},
) {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return;

  const admin = new AwsS3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
  });
  const Bucket = env.S3_BUCKET;

  try {
    for (let attempt = 1; ; attempt++) {
      try {
        const exists = await admin.send(new HeadBucketCommand({ Bucket })).then(
          () => true,
          (error: { $metadata?: { httpStatusCode?: number } }) => {
            if (error.$metadata?.httpStatusCode === 404) return false;
            throw error;
          },
        );
        if (!exists) await admin.send(new CreateBucketCommand({ Bucket }));

        await admin.send(
          new PutBucketCorsCommand({
            Bucket,
            CORSConfiguration: { CORSRules: bucketCorsRules(origins) },
          }),
        );

        logger.info({ bucket: Bucket, created: !exists }, "storage bucket ready");
        return;
      } catch (error) {
        // The storage container may still be starting
        if (attempt >= attempts) throw error;
        await Bun.sleep(delayMs);
      }
    }
  } finally {
    admin.destroy();
  }
}
