import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5084),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1),

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
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(`❌ Некорректные переменные окружения:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const env = parsed.data;
