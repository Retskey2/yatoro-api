import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default(5084),
});

export const env = envSchema.parse(process.env);
