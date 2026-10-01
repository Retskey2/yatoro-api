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
 * S3-compatible object storage (see docs/adr/0002-video-pipeline-infrastructure.md).
 *
 * Two clients on purpose: inside Docker the API reaches the storage as `seaweedfs:8333`,
 * while browsers reach it as `localhost:9000`. The host is part of a presigned URL's signature,
 * so URLs handed to browsers are signed by `public`; everything server-side goes through `internal`.
 */
export interface Storage {
  bucket: string;
  internal: Bun.S3Client;
  public: Bun.S3Client;
}

function createStorage(): Storage | null {
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null;

  const client = (endpoint: string) =>
    new Bun.S3Client({
      endpoint,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });

  return {
    bucket: env.S3_BUCKET,
    internal: client(env.S3_ENDPOINT),
    public: client(env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT),
  };
}

export const storage = createStorage();

export function requireStorage(): Storage {
  if (!storage) {
    throw new ServiceUnavailableError("Хранилище файлов не настроено (S3_ENDPOINT)");
  }
  return storage;
}

/** `true` if the bucket answers within the timeout; `null` if storage is not configured */
export async function isStorageReachable(timeoutMs = 2_000): Promise<boolean | null> {
  if (!storage) return null;

  const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  const probe = storage.internal.list({ maxKeys: 1 }).then(
    () => true,
    () => false,
  );

  return await Promise.race([probe, timeout]);
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
