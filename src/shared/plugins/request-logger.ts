import { Elysia } from "elysia";
import { logger } from "@/shared/logger";

const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;
const startedAt = new WeakMap<Request, number>();

export const requestLogger = new Elysia({ name: "request-logger" })
  .onRequest(({ request, set }) => {
    startedAt.set(request, performance.now());

    const incoming = request.headers.get("x-request-id");
    set.headers["x-request-id"] =
      incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : crypto.randomUUID();
  })
  .onAfterResponse({ as: "global" }, ({ request, set }) => {
    const start = startedAt.get(request);

    logger.info(
      {
        requestId: set.headers["x-request-id"],
        method: request.method,
        path: new URL(request.url).pathname,
        status: set.status,
        durationMs: start === undefined ? undefined : Math.round(performance.now() - start),
      },
      "request",
    );
  });
