import { Elysia } from "elysia";
import { bearerAuth, IdParams, Page, PaginationQuery } from "@/shared/http";
import { authGuard } from "@/shared/plugins/auth";
import {
  AnimeDetails,
  AnimeSummary,
  CreateAnimeBody,
  CreateEpisodeBody,
  Episode,
} from "./anime.model";
import { AnimeService } from "./anime.service";

const animeService = new AnimeService();

export const animePlugin = new Elysia({ prefix: "/anime", tags: ["Anime"] })
  .use(authGuard)

  .get("", ({ query }) => animeService.getAnimePage(query), {
    query: PaginationQuery,
    response: Page(AnimeSummary),
    detail: { summary: "Каталог (новые первыми, cursor-пагинация)" },
  })

  .get("/:id", ({ params }) => animeService.getAnimeById(params.id), {
    params: IdParams,
    response: AnimeDetails,
    detail: { summary: "Аниме с жанрами и сериями" },
  })

  .post("", async ({ body, status }) => status(201, await animeService.createAnime(body)), {
    role: "ADMIN",
    body: CreateAnimeBody,
    response: { 201: AnimeSummary },
    detail: { summary: "Добавить аниме", security: bearerAuth },
  })

  .post(
    "/:id/episodes",
    async ({ params, body, status }) =>
      status(201, await animeService.addEpisodeToAnime(params.id, body)),
    {
      role: "ADMIN",
      params: IdParams,
      body: CreateEpisodeBody,
      response: { 201: Episode },
      detail: { summary: "Добавить серию", security: bearerAuth },
    },
  );
