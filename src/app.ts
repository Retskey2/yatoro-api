import { join } from "node:path";
import { Elysia } from "elysia";
import { apiRouter } from "./modules";
import { healthPlugin } from "./modules/health/health.controller";
import { setup } from "./setup";

export const app = new Elysia()
  .use(setup)
  .get(
    "/",
    () => {
      return {
        status: "ok",
        message: "Yatoro API is running",
        docs: "/docs",
        demo: "/demo",
      };
    },
    { detail: { hide: true } },
  )
  // A single static page: catalog search, admin upload with progress, HLS player (hls.js)
  .get("/demo", () => Bun.file(join(import.meta.dir, "demo/index.html")), {
    detail: { hide: true },
  })
  .use(healthPlugin)
  .use(apiRouter);

export type App = typeof app;
