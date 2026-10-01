import { Elysia, t } from "elysia";
import { Episode, EpisodeParams } from "@/modules/anime/anime.model";
import { auditContext } from "@/modules/audit/audit.model";
import { bearerAuth } from "@/shared/http";
import { authGuard } from "@/shared/plugins/auth";
import { RENDITION_PATTERN } from "./hls";
import { RequestUploadBody, UploadTicket } from "./video.model";
import { VideoService } from "./video.service";

const videoService = new VideoService();

const HLS_HEADERS = {
  "content-type": "application/vnd.apple.mpegurl",
  // Signed URLs inside expire in hours; a short cache keeps players from refetching on seek
  "cache-control": "private, max-age=60",
};

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
  )

  .get(
    "/:id/episodes/:number/video/master.m3u8",
    async ({ params, set }) => {
      Object.assign(set.headers, HLS_HEADERS);
      return await videoService.masterPlaylist(params.id, params.number);
    },
    {
      params: EpisodeParams,
      response: t.String(),
      detail: {
        summary: "HLS: master-плейлист серии",
        description:
          "Точка входа для плеера (hls.js, Safari). Качества указаны относительными путями, " +
          "поэтому плеер сам запросит соседние `…/video/{rendition}/index.m3u8`.",
      },
    },
  )

  .get(
    "/:id/episodes/:number/video/:rendition/index.m3u8",
    async ({ params, set }) => {
      Object.assign(set.headers, HLS_HEADERS);
      return await videoService.renditionPlaylist(params.id, params.number, params.rendition);
    },
    {
      params: t.Object({
        ...EpisodeParams.properties,
        rendition: t.String({ pattern: RENDITION_PATTERN }),
      }),
      response: t.String(),
      detail: {
        summary: "HLS: плейлист одного качества",
        description:
          "Сегменты и init-сегмент (`#EXT-X-MAP`) заменены подписанными ссылками на хранилище — " +
          "видео идёт к плееру напрямую, бакет остаётся закрытым.",
      },
    },
  );
