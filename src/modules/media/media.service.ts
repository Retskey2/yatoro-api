import { join } from "node:path";
import { fileTypeFromBlob } from "file-type";
import { env } from "@/config/env";
import { BadRequestError } from "@/shared/errors";

export const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
} as const;

export type ImageKind = "avatar" | "poster";

const IMAGE_FOLDERS: Record<ImageKind, string> = {
  avatar: "avatars",
  poster: "posters",
};

export class MediaService {
  async uploadImage(file: File, kind: ImageKind) {
    return await this.saveFile(file, IMAGE_FOLDERS[kind], IMAGE_TYPES);
  }

  /**
   * Never trusts the client: the type is detected from the file's magic bytes
   * and the extension comes from that type, not from the original file name.
   */
  private async saveFile(file: File, folder: string, allowed: Record<string, string>) {
    const detected = await fileTypeFromBlob(file);
    const ext = detected ? allowed[detected.mime] : undefined;

    if (!ext) {
      throw new BadRequestError("Недопустимый тип файла", { allowed: Object.keys(allowed) });
    }

    const fileName = `${Bun.randomUUIDv7()}.${ext}`;
    await Bun.write(join(env.UPLOADS_DIR, folder, fileName), file);

    return `/uploads/${folder}/${fileName}`;
  }
}
