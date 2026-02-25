import { Elysia } from "elysia";
import { apiRouter } from "./modules";
import { setup } from "./setup";

export const app = new Elysia()
  .use(setup)
  .get("/", () => {
    return {
      status: "ok",
      message: "Yotaro API is running",
    };
  })
  .use(apiRouter);

export type App = typeof app;
