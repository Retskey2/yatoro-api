import { randomUUID } from "crypto";

type UploadFolder = "avatars" | "posters" | "shorts" | "episodes";

export const MediaService = {
  uploadFile: async (file: File, folder: UploadFolder) => {
    const ext = file.name.split(".").pop();

    const uniqueName = `${randomUUID()}.${ext}`;

    const filePath = `./uploads/${folder}/${uniqueName}`;

    await Bun.write(filePath, file);

    return `/uploads/${folder}/${uniqueName}`;
  },
};
