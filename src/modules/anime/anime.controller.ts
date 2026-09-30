import { Elysia } from "elysia";
import { bearerAuth, IdParams, Page, SlugParams } from "@/shared/http";
import { authGuard } from "@/shared/plugins/auth";
import {
  AnimeDetails,
  AnimeSummary,
  CatalogQuery,
  CreateAnimeBody,
  CreateEpisodeBody,
  Episode,
} from "./anime.model";
import { AnimeService } from "./anime.service";

const animeService = new AnimeService();

export const animePlugin = new Elysia({ prefix: "/anime", tags: ["Anime"] })
  .use(authGuard)

  .get("", ({ query }) => animeService.getCatalogPage(query), {
    query: CatalogQuery,
    response: Page(AnimeSummary),
    detail: {
      summary: "Каталог: поиск, фильтры, сортировка",
      description:
        "`q` — гибридный поиск (полнотекстовый + триграммы, устойчив к опечаткам). " +
        "Массивы передаются повтором параметра: `?kind=TV&kind=MOVIE`. " +
        "`genres` — AND: у аниме должны быть все перечисленные жанры. " +
        "Пагинация — непрозрачный `cursor` из предыдущего ответа.",
    },
  })

  .get("/by-slug/:slug", ({ params }) => animeService.getAnimeBySlug(params.slug), {
    params: SlugParams,
    response: AnimeDetails,
    detail: { summary: "Аниме по slug" },
  })

  .get("/:id", ({ params }) => animeService.getAnimeById(params.id), {
    params: IdParams,
    response: AnimeDetails,
    detail: { summary: "Аниме с жанрами, студиями и сериями" },
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
