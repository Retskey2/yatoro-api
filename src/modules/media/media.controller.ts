import { Elysia, t } from "elysia";
import { ForbiddenError } from "@/shared/errors";
import { bearerAuth } from "@/shared/http";
import { authGuard, hasRole } from "@/shared/plugins/auth";
import { IMAGE_TYPES, MediaService } from "./media.service";

const mediaService = new MediaService();

const UploadResponse = t.Object({ url: t.String() });

export const mediaPlugin = new Elysia({ prefix: "/media", tags: ["Media"] })
  .use(authGuard)

  .post(
    "/images",
    async ({ body, user, status }) => {
      if (body.kind === "poster" && !hasRole(user.role, "ADMIN")) {
        throw new ForbiddenError("Загружать постеры могут только администраторы");
      }

      return status(201, { url: await mediaService.uploadImage(body.file, body.kind) });
    },
    {
      auth: true,
      body: t.Object({
        file: t.File({ type: Object.keys(IMAGE_TYPES), maxSize: "5m" }),
        kind: t.UnionEnum(["avatar", "poster"]),
      }),
      response: { 201: UploadResponse },
      detail: { summary: "Загрузить изображение (аватар или постер)", security: bearerAuth },
    },
  );
