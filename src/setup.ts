import { Elysia } from "elysia";
import { logger } from "elysia-logger";
import { env } from "./config/env";
import cors from "@elysiajs/cors";
import { rateLimit } from "elysia-rate-limit";

export const setup = new Elysia({ name: "setup" })
  .use(logger({ level: env.LOG_LEVEL }))
  .use(
    cors({
      origin: ["http://localhost:3001", "http://localhost:4000"],
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  )
  .use(
    rateLimit({
      max: 60,
      duration: 60000,
      generator: (req, server) =>
        req.headers.get("x-api-key") || server?.requestIP(req)?.address || "",
      errorResponse: new Response(
        JSON.stringify({
          status: 429,
          message: "Too many requests - try again later",
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    }),
  )
  .onError(({ code, error, set }) => {
    const response = {
      success: false,
      message: "Произошла неизвестная ошибка",
      details: null as any,
    };

    if (code === "VALIDATION") {
      set.status = 400;
      response.message = "Ошибка валидации данных";

      response.details = error.all.map((err) => ({
        field: err.summary?.replace("/", ""),
        message: err.summary,
      }));
      return response;
    }

    if (code === "NOT_FOUND") {
      set.status = 404;
      response.message = "Маршрут не найден";
      return response;
    }

    if (error instanceof Error) {
      if (set.status === 200) set.status = 500;

      response.message = error.message;
      return response;
    }

    set.status = 500;
    return response;
  });
