import Elysia from "elysia";
import { usersPlugin } from "./users/users.controller";
import { animePlugin } from "./anime/anime.controller";
import { mediaPlugin } from "./media/media.controller";
import { authPlugin } from "./auth/auth.controller";

export const apiRouter = new Elysia({ prefix: "/api" })
  .use(authPlugin)
  .use(usersPlugin)
  .use(animePlugin)
  .use(mediaPlugin);
