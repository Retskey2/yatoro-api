import Elysia from "elysia";
import { usersPlugin } from "./users/users.plugin";
import { animePlugin } from "./anime/anime.plugin";

export const apiRouter = new Elysia({ prefix: "/api" })
  .use(usersPlugin)
  .use(animePlugin);
