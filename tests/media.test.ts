import { beforeEach, describe, expect, it } from "bun:test";
import { api, createUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

// Smallest valid PNG (1×1 px)
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("POST /api/media/images", () => {
  it("rejects HTML disguised as an image (A3 regression: stored XSS)", async () => {
    const user = await createUser();
    const html = new File(["<script>alert(document.cookie)</script>"], "avatar.png", {
      type: "image/png",
    });

    const { status } = await api.media.images.post(
      { file: html, kind: "avatar" },
      { headers: user.headers },
    );

    expect(status).toBe(400);
  });

  it("derives the extension from the real content, not from the file name", async () => {
    const user = await createUser();
    const png = new File([PNG_BYTES], "photo.jpg", { type: "image/jpeg" });

    const { status, data } = await api.media.images.post(
      { file: png, kind: "avatar" },
      { headers: user.headers },
    );

    expect(status).toBe(201);
    expect(data?.url).toMatch(/^\/uploads\/avatars\/[\w-]+\.png$/);
  });

  it("rejects a dangerous file name even with valid image content", async () => {
    const user = await createUser();
    const png = new File([PNG_BYTES], "evil.html", { type: "image/png" });

    const { status } = await api.media.images.post(
      { file: png, kind: "avatar" },
      { headers: user.headers },
    );

    expect(status).toBe(400);
  });

  it("allows posters only for admins", async () => {
    const user = await createUser();
    const admin = await createUser("ADMIN");
    const poster = () => ({ file: new File([PNG_BYTES], "p.png", { type: "image/png" }) });

    const asUser = await api.media.images.post(
      { ...poster(), kind: "poster" },
      { headers: user.headers },
    );
    const asAdmin = await api.media.images.post(
      { ...poster(), kind: "poster" },
      { headers: admin.headers },
    );

    expect(asUser.status).toBe(403);
    expect(asAdmin.status).toBe(201);
  });

  it("requires authentication", async () => {
    const png = new File([PNG_BYTES], "a.png", { type: "image/png" });
    const { status } = await api.media.images.post({ file: png, kind: "avatar" });
    expect(status).toBe(401);
  });
});
