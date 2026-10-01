import { mkdirSync } from "node:fs";
import cors from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import staticPlugin from "@elysiajs/static";
import { Elysia } from "elysia";
import { env } from "./config/env";
import { errorHandler } from "./shared/plugins/error-handler";
import { rateLimiter } from "./shared/plugins/rate-limit";
import { requestLogger } from "./shared/plugins/request-logger";

// The static plugin scans this directory as soon as it is created
mkdirSync(env.UPLOADS_DIR, { recursive: true });

export const setup = new Elysia({ name: "setup" })
  .use(requestLogger)
  .use(errorHandler)
  .use(
    cors({
      origin: env.CORS_ORIGINS,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
      exposeHeaders: [
        "X-Request-Id",
        "RateLimit-Limit",
        "RateLimit-Remaining",
        "RateLimit-Reset",
        "Retry-After",
      ],
    }),
  )
  .use(rateLimiter)
  .use(
    staticPlugin({
      assets: env.UPLOADS_DIR,
      prefix: "/uploads",
      // Defense in depth: even if a file were misinterpreted, nothing in it can execute
      headers: {
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    }),
  )
  .use(
    openapi({
      path: "/docs",
      documentation: {
        info: {
          title: "Yatoro API",
          version: "0.1.0",
          description: "Бэкенд аниме-кинотеки на Bun + Elysia",
        },
        tags: [
          { name: "Auth", description: "Регистрация и вход" },
          { name: "Users", description: "Профили пользователей" },
          { name: "Anime", description: "Каталог и серии" },
          { name: "Genres", description: "Жанры" },
          { name: "Media", description: "Загрузка изображений" },
          { name: "Video", description: "Загрузка видео серий и их обработка" },
          { name: "Health", description: "Состояние сервиса" },
          { name: "Admin", description: "Журнал действий администраторов" },
        ],
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          },
        },
      },
    }),
  );
