import { Elysia, t } from "elysia";
import { MediaService, ImageFolder, VideoFolder } from "./media.service";
import { isAuthenticated } from "@/shared/middlewares/auth.middleware";

const mediaService = new MediaService();

export const mediaPlugin = new Elysia({ prefix: "/media" })
  .use(isAuthenticated)

  .post(
    "/upload/image",
    async ({ body, set }) => {
      const url = await mediaService.uploadImage(
        body.image,
        body.folder as ImageFolder,
      );

      set.status = 201;
      return {
        message: "Изображение загружено",
        url: url,
      };
    },
    {
      body: t.Object({
        image: t.File({ maxSize: 5 * 1024 * 1024 }),
        folder: t.Union([t.Literal("avatars"), t.Literal("posters")]),
      }),
    },
  )

  .post(
    "/upload/video",
    async ({ body, set, user }) => {
      const url = await mediaService.uploadVideo(
        body.video,
        body.folder as VideoFolder,
        user.role,
      );

      set.status = 201;
      return {
        message: "Видео загружено",
        url: url,
      };
    },
    {
      body: t.Object({
        video: t.File({ maxSize: 100 * 1024 * 1024 }),
        folder: t.Union([t.Literal("shorts"), t.Literal("episodes")]),
      }),
    },
  );
