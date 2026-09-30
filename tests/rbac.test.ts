import { beforeEach, describe, expect, it } from "bun:test";
import { api, createUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

const newAnime = { title: "Sousou no Frieren" };

describe("role-based access control", () => {
  it("rejects anonymous requests with 401", async () => {
    const { status } = await api.anime.post(newAnime);
    expect(status).toBe(401);
  });

  it("forbids a regular USER from ADMIN-only routes (A1 regression)", async () => {
    // The old `isRole` macro (v1 syntax) was silently ignored by Elysia 1.4,
    // so any registered user could create anime and episodes.
    const user = await createUser("USER");

    const { status, error } = await api.anime.post(newAnime, { headers: user.headers });

    expect(status).toBe(403);
    expect(error?.value).toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("forbids a MODERATOR from ADMIN-only routes", async () => {
    const moderator = await createUser("MODERATOR");
    const { status } = await api.anime.post(newAnime, { headers: moderator.headers });
    expect(status).toBe(403);
  });

  it("allows an ADMIN", async () => {
    const admin = await createUser("ADMIN");
    const { status, data } = await api.anime.post(newAnime, { headers: admin.headers });

    expect(status).toBe(201);
    expect(data?.title).toBe(newAnime.title);
  });

  it("rejects a tampered token", async () => {
    const user = await createUser("ADMIN");
    const tampered = `${user.headers.authorization.slice(0, -4)}AAAA`;

    const { status } = await api.users.me.get({ headers: { authorization: tampered } });
    expect(status).toBe(401);
  });

  it("applies a role change immediately, without a new token", async () => {
    const admin = await createUser("ADMIN");
    const { db } = await import("@/database");
    const { users } = await import("@/database/schema");
    const { eq } = await import("drizzle-orm");

    await db.update(users).set({ role: "USER" }).where(eq(users.id, admin.id));

    const { status } = await api.anime.post(newAnime, { headers: admin.headers });
    expect(status).toBe(403);
  });

  it("keeps public routes open", async () => {
    expect((await api.anime.get()).status).toBe(200);
    expect((await api.genres.get()).status).toBe(200);
  });
});
