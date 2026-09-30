import { Elysia, t } from "elysia";
import { bearerAuth } from "@/shared/http";
import { authGuard } from "@/shared/plugins/auth";
import { CreateGenreBody, Genre } from "./genres.model";
import { GenresService } from "./genres.service";

const genresService = new GenresService();

export const genresPlugin = new Elysia({ prefix: "/genres", tags: ["Genres"] })
  .use(authGuard)

  .get("", () => genresService.getAll(), {
    response: t.Array(Genre),
    detail: { summary: "Список жанров" },
  })

  .post("", async ({ body, status }) => status(201, await genresService.create(body)), {
    role: "ADMIN",
    body: CreateGenreBody,
    response: { 201: Genre },
    detail: { summary: "Создать жанр", security: bearerAuth },
  });
