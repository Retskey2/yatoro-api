// src/domains/anime/anime.plugin.ts
import { Elysia, t } from "elysia";
import { AnimeRepository } from "./anime.repository";
import { isAuthenticated } from "@/domains/users/auth.middleware";

export const animePlugin = new Elysia({ prefix: "/anime" })
  .get("/", async () => {
    return await AnimeRepository.getAll();
  })

  .get(
    "/:id",
    async ({ params, set }) => {
      const animeData = await AnimeRepository.getById(params.id);

      if (!animeData) {
        set.status = 404;
        return { message: "Аниме не найдено" };
      }

      return animeData;
    },
    {
      params: t.Object({
        id: t.Numeric(),
      }),
    },
  )

  .guard({}, (app) =>
    app.use(isAuthenticated).post(
      "/",
      async ({ body, set, user }) => {
        const newAnime = await AnimeRepository.create({
          title: body.title,
          description: body.description,
          posterUrl: body.posterUrl,
          status: body.status,
        });

        set.status = 201;
        return {
          message: "Аниме успешно добавлено!",
          anime: newAnime,
          addedBy: user.username,
        };
      },
      {
        isRole: "ADMIN",

        body: t.Object({
          title: t.String({ minLength: 1 }),
          description: t.Optional(t.String()),
          posterUrl: t.Optional(t.String()),
          status: t.Optional(t.String()),
        }),
      },
    ),
  );
