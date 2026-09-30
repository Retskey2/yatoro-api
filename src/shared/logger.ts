import pino from "pino";
import { env } from "@/config/env";

const options: pino.LoggerOptions = { level: env.LOG_LEVEL };

// Human-readable output in development, structured JSON everywhere else.
// pino-pretty is a dev dependency, so it is only imported when needed.
export const logger =
  env.NODE_ENV === "development"
    ? pino(
        options,
        (await import("pino-pretty")).default({
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        }),
      )
    : pino(options);
