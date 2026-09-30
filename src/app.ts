import { Elysia } from "elysia";
import { apiRouter } from "./modules";
import { setup } from "./setup";

export const app = new Elysia()
  .use(setup)
  .get(
    "/",
    () => {
      return {
        status: "ok",
        message: "Yatoro API is running",
      };
    },
    { detail: { hide: true } },
  )
  .use(apiRouter);

export type App = typeof app;
