import Elysia from "elysia";
import { animePlugin } from "./anime/anime.controller";
import { auditPlugin } from "./audit/audit.controller";
import { authPlugin } from "./auth/auth.controller";
import { genresPlugin } from "./genres/genres.controller";
import { mediaPlugin } from "./media/media.controller";
import { usersPlugin } from "./users/users.controller";

export const apiRouter = new Elysia({ prefix: "/api" })
  .use(authPlugin)
  .use(usersPlugin)
  .use(animePlugin)
  .use(genresPlugin)
  .use(mediaPlugin)
  .use(auditPlugin);
