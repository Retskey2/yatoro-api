import { randomUUID } from "crypto";

export type ImageFolder = "avatars" | "posters";
export type VideoFolder = "shorts" | "episodes";
export type UploadFolder = ImageFolder | VideoFolder;

export class MediaService {
  async uploadImage(file: File, folder: ImageFolder) {
    if (!file.type.startsWith("image/")) {
      throw new Error("Файл должен быть изображением");
    }

    return await this.saveFile(file, folder);
  }

  async uploadVideo(file: File, folder: VideoFolder, userRole?: string) {
    if (folder === "episodes" && userRole !== "ADMIN") {
      throw new Error("Только администраторы могут загружать серии");
    }

    if (!file.type.startsWith("video/")) {
      throw new Error("Файл должен быть видеоформата");
    }

    return await this.saveFile(file, folder);
  }

  private async saveFile(file: File, folder: UploadFolder) {
    const ext = file.name.split(".").pop();
    const uniqueName = `${randomUUID()}.${ext}`;
    const filePath = `./uploads/${folder}/${uniqueName}`;

    await Bun.write(filePath, file);

    return `/uploads/${folder}/${uniqueName}`;
  }
}
