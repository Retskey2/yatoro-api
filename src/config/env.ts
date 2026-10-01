import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(5084),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    JWT_SECRET: z.string().min(32, "JWT_SECRET должен быть не короче 32 символов"),
    JWT_ACCESS_TTL: z.string().default("1h"),

    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    TRUST_PROXY: z.stringbool().default(false),
    RATE_LIMIT_ENABLED: z.stringbool().default(true),

    UPLOADS_DIR: z.string().default("uploads"),

    // S3-compatible object storage (SeaweedFS in docker compose). Optional: without it the API
    // runs as before and video endpoints answer 503.
    S3_ENDPOINT: z.url().optional(),
    // What browsers use. The host is part of a presigned URL's signature, so URLs handed to
    // browsers must be signed for this address (inside Docker the API sees another one)
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET: z.string().default("yatoro-media"),
    S3_REGION: z.string().default("us-east-1"),

    // Shikimori asks API clients to identify themselves (never mimic a browser)
    SHIKIMORI_USER_AGENT: z.string().min(1).default("Yatoro"),
  })
  .superRefine((value, ctx) => {
    if (value.S3_ENDPOINT && (!value.S3_ACCESS_KEY_ID || !value.S3_SECRET_ACCESS_KEY)) {
      ctx.addIssue({
        code: "custom",
        path: ["S3_ACCESS_KEY_ID"],
        message: "S3_ACCESS_KEY_ID и S3_SECRET_ACCESS_KEY обязательны, если задан S3_ENDPOINT",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(`❌ Некорректные переменные окружения:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const env = parsed.data;
