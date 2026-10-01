import { Elysia } from "elysia";
import { auditContext } from "@/modules/audit/audit.model";
import { bearerAuth, IdParams, Page, SlugParams } from "@/shared/http";
import { authGuard } from "@/shared/plugins/auth";
import {
  AnimeDetails,
  AnimeSummary,
  CatalogQuery,
  CreateAnimeBody,
  CreateEpisodeBody,
  Episode,
  EpisodeParams,
  UpdateAnimeBody,
  UpdateEpisodeBody,
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

  .post(
    "",
    async ({ body, user, set, status }) =>
      status(201, await animeService.createAnime(body, auditContext(user, set))),
    {
      role: "ADMIN",
      body: CreateAnimeBody,
      response: { 201: AnimeSummary },
      detail: { summary: "Добавить аниме", security: bearerAuth },
    },
  )

  .patch(
    "/:id",
    ({ params, body, user, set }) =>
      animeService.updateAnime(params.id, body, auditContext(user, set)),
    {
      role: "ADMIN",
      params: IdParams,
      body: UpdateAnimeBody,
      response: AnimeDetails,
      detail: {
        summary: "Изменить аниме",
        description:
          "Частичное обновление: пропущенное поле не меняется, `null` очищает его. " +
          "`genreIds` заменяет набор жанров целиком. Изменения пишутся в журнал действий.",
        security: bearerAuth,
      },
    },
  )

  .delete(
    "/:id",
    async ({ params, user, set, status }) => {
      await animeService.deleteAnime(params.id, auditContext(user, set));
      return status(204);
    },
    {
      role: "ADMIN",
      params: IdParams,
      detail: { summary: "Удалить аниме вместе с сериями", security: bearerAuth },
    },
  )

  .post(
    "/:id/episodes",
    async ({ params, body, user, set, status }) =>
      status(201, await animeService.addEpisodeToAnime(params.id, body, auditContext(user, set))),
    {
      role: "ADMIN",
      params: IdParams,
      body: CreateEpisodeBody,
      response: { 201: Episode },
      detail: { summary: "Добавить серию", security: bearerAuth },
    },
  )

  .patch(
    "/:id/episodes/:number",
    ({ params, body, user, set }) =>
      animeService.updateEpisode(params.id, params.number, body, auditContext(user, set)),
    {
      role: "ADMIN",
      params: EpisodeParams,
      body: UpdateEpisodeBody,
      response: Episode,
      detail: { summary: "Изменить серию", security: bearerAuth },
    },
  )

  .delete(
    "/:id/episodes/:number",
    async ({ params, user, set, status }) => {
      await animeService.deleteEpisode(params.id, params.number, auditContext(user, set));
      return status(204);
    },
    {
      role: "ADMIN",
      params: EpisodeParams,
      detail: { summary: "Удалить серию", security: bearerAuth },
    },
  );
