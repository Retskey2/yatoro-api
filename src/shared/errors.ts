export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const errorBody = (code: string, message: string, details?: unknown): ErrorBody => ({
  error: details === undefined ? { code, message } : { code, message, details },
});

/**
 * Expected, client-facing error. Anything that is not an AppError
 * is treated as a bug and reported as a generic 500.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Некорректный запрос", details?: unknown) {
    super(400, "BAD_REQUEST", message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Требуется авторизация") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Недостаточно прав") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Ресурс не найден") {
    super(404, "NOT_FOUND", message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Конфликт данных") {
    super(409, "CONFLICT", message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Сервис временно недоступен") {
    super(503, "SERVICE_UNAVAILABLE", message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Слишком много запросов, попробуйте позже") {
    super(429, "TOO_MANY_REQUESTS", message);
  }
}
