import { Elysia } from "elysia";
import { Episode, EpisodeParams } from "@/modules/anime/anime.model";
import { auditContext } from "@/modules/audit/audit.model";
import { bearerAuth } from "@/shared/http";
import { authGuard } from "@/shared/plugins/auth";
import { RequestUploadBody, UploadTicket } from "./video.model";
import { VideoService } from "./video.service";

const videoService = new VideoService();

export const videoPlugin = new Elysia({ prefix: "/anime", tags: ["Video"] })
  .use(authGuard)

  .post(
    "/:id/episodes/:number/video/upload",
    async ({ params, body, user, set, status }) =>
      status(
        201,
        await videoService.requestUpload(
          params.id,
          params.number,
          body.size,
          auditContext(user, set),
        ),
      ),
    {
      role: "ADMIN",
      params: EpisodeParams,
      body: RequestUploadBody,
      response: { 201: UploadTicket },
      detail: {
        summary: "Начать загрузку видео серии",
        description:
          "Возвращает подписанную ссылку: файл загружается `PUT`-запросом прямо в хранилище, мимо API. " +
          "После загрузки вызовите `…/video/complete`.",
        security: bearerAuth,
      },
    },
  )

  .post(
    "/:id/episodes/:number/video/complete",
    ({ params, user, set }) =>
      videoService.completeUpload(params.id, params.number, auditContext(user, set)),
    {
      role: "ADMIN",
      params: EpisodeParams,
      response: Episode,
      detail: {
        summary: "Завершить загрузку видео серии",
        description:
          "Проверяет загруженный файл по его содержимому (не по заявленному типу) и ставит " +
          "серию в очередь на перекодирование. Не видео удаляется, серия получает статус FAILED.",
        security: bearerAuth,
      },
    },
  );
