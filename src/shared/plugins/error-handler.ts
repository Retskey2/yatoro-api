import { Elysia } from "elysia";
import { AppError, errorBody } from "@/shared/errors";
import { logger } from "@/shared/logger";

/**
 * Single place that turns errors into HTTP responses.
 * Internal details (SQL, stack traces, driver messages) never leave the server.
 */
export const errorHandler = new Elysia({ name: "error-handler" }).onError(
  { as: "global" },
  ({ code, error, set, request }) => {
    if (error instanceof AppError) {
      set.status = error.status;
      return errorBody(error.code, error.message, error.details);
    }

    switch (code) {
      case "VALIDATION":
        set.status = 400;
        return errorBody(
          "VALIDATION_ERROR",
          "Ошибка валидации данных",
          error.all.map((issue) => ({
            path: "path" in issue ? issue.path : undefined,
            message: issue.summary ?? issue.message,
          })),
        );
      case "INVALID_FILE_TYPE":
        set.status = 400;
        return errorBody("INVALID_FILE_TYPE", "Недопустимый тип файла");
      case "PARSE":
        set.status = 400;
        return errorBody("INVALID_BODY", "Не удалось разобрать тело запроса");
      case "NOT_FOUND":
        set.status = 404;
        return errorBody("ROUTE_NOT_FOUND", "Маршрут не найден");
    }

    // Responses thrown via Elysia's `status()` already carry their own status and body
    if (typeof code === "number") return;

    logger.error({ err: error, method: request.method, url: request.url }, "Unhandled error");
    set.status = 500;
    return errorBody("INTERNAL_ERROR", "Внутренняя ошибка сервера");
  },
);
