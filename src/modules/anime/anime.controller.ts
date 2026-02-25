import { Elysia, t } from "elysia";
import { AnimeService } from "./anime.service";
import { isAuthenticated } from "@/shared/middlewares/auth.middleware";

const animeService = new AnimeService();

export const animePlugin = new Elysia({ prefix: "/anime" })
  .get("/", async () => {
    return await animeService.getAllAnime();
  })

  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        return await animeService.getAnimeById(params.id);
      } catch (error: any) {
        set.status = 404;
        return { message: error.message };
      }
    },
    {
      params: t.Object({
        id: t.Numeric(),
      }),
    },
  )

  .guard({}, (app) =>
    app
      .use(isAuthenticated)
      .post(
        "/",
        async ({ body, set, user }) => {
          const newAnime = await animeService.createAnime({
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
      )

      .post(
        "/:id/episodes",
        async ({ params, body, set }) => {
          try {
            const newEpisode = await animeService.addEpisodeToAnime(params.id, {
              episodeNumber: body.episodeNumber,
              title: body.title,
              videoUrl: body.videoUrl,
            });

            set.status = 201;
            return {
              message: "Эпизод успешно добавлен",
              episode: newEpisode,
            };
          } catch (error: any) {
            set.status = 404;
            return { message: error.message };
          }
        },
        {
          isRole: "ADMIN",
          params: t.Object({
            id: t.Numeric(),
          }),
          body: t.Object({
            episodeNumber: t.Numeric(),
            title: t.Optional(t.String()),
            videoUrl: t.String(),
          }),
        },
      ),
  );
