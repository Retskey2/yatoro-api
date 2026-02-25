import { Elysia, t } from "elysia";
import { MediaService } from "./media.service";
import { isAuthenticated } from "@/domains/users/auth.middleware";

export const mediaPlugin = new Elysia({ prefix: "/media" })
  .use(isAuthenticated)
  .post(
    "/upload/image",
    async ({ body, set }) => {
      if (!body.image.type.startsWith("image/")) {
        set.status = 400;
        throw new Error("Файл должен быть изображением");
      }

      const url = await MediaService.uploadFile(body.image, body.folder as any);

      set.status = 201;
      return {
        message: "Изображение загружено",
        url: url,
      };
    },
    {
      body: t.Object({
        image: t.File({
          maxSize: 5 * 1024 * 1024,
        }),
        folder: t.Union([t.Literal("avatars"), t.Literal("posters")]),
      }),
    },
  )

  .post(
    "/upload/video",
    async ({ body, set, user }) => {
      if (body.folder === "episodes" && user.role !== "ADMIN") {
        set.status = 403;
        throw new Error("Только администраторы могут загружать серии");
      }

      if (!body.video.type.startsWith("video/")) {
        set.status = 400;
        throw new Error("Файл должен быть видеоформата");
      }

      const url = await MediaService.uploadFile(body.video, body.folder as any);

      set.status = 201;
      return {
        message: "Видео загружено",
        url: url,
      };
    },
    {
      body: t.Object({
        video: t.File({
          maxSize: 100 * 1024 * 1024,
        }),
        folder: t.Union([t.Literal("shorts"), t.Literal("episodes")]),
      }),
    },
  );
