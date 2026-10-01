import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/database";
import { anime, auditLog, episodes, users } from "@/database/schema";
import { AuditRepository } from "@/modules/audit/audit.repository";
import { api, createUser, resetDatabase } from "./helpers";

type TestUser = Awaited<ReturnType<typeof createUser>>;
let admin: TestUser;
let user: TestUser;

beforeEach(async () => {
  await resetDatabase();
  admin = await createUser("ADMIN");
  user = await createUser("USER");
});

const createGenre = async (name: string, slug: string) => {
  const { data } = await api.genres.post({ name, slug }, { headers: admin.headers });
  if (!data) throw new Error("genre was not created");
  return data;
};

const createAnime = async (body: Parameters<typeof api.anime.post>[0]) => {
  const { data } = await api.anime.post(body, { headers: admin.headers });
  if (!data) throw new Error("anime was not created");
  return data;
};

const auditFor = (entityType: string, entityId: number) =>
  db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(asc(auditLog.id));

describe("PATCH /api/anime/:id", () => {
  it("updates fields, re-derives the season and logs only what changed", async () => {
    const created = await createAnime({ title: "Old title", airedOn: "2020-01-10" });

    const { status, data } = await api
      .anime({ id: created.id })
      .patch({ title: "New title", airedOn: "2023-09-29" }, { headers: admin.headers });

    expect(status).toBe(200);
    expect(data).toMatchObject({ title: "New title", year: 2023, season: "FALL" });

    const [create, update] = await auditFor("anime", created.id);
    expect(create?.action).toBe("anime.create");
    expect(update).toMatchObject({ action: "anime.update", actorId: admin.id });
    expect(update?.requestId).toEqual(expect.any(String));
    expect(Object.keys(update?.changes ?? {}).sort()).toEqual([
      "airedOn",
      "season",
      "title",
      "year",
    ]);
    expect(update?.changes.title).toEqual({ from: "Old title", to: "New title" });
    expect(update?.changes.season).toEqual({ from: "WINTER", to: "FALL" });
  });

  it("replaces genres and logs them by slug", async () => {
    const action = await createGenre("Экшен", "action");
    const drama = await createGenre("Драма", "drama");
    const created = await createAnime({ title: "Show", genreIds: [action.id] });

    const { data } = await api
      .anime({ id: created.id })
      .patch({ genreIds: [drama.id] }, { headers: admin.headers });

    expect(data?.genres.map((genre) => genre.slug)).toEqual(["drama"]);
    const [, update] = await auditFor("anime", created.id);
    expect(update?.changes.genres).toEqual({ from: ["action"], to: ["drama"] });
  });

  it("clears a field with null", async () => {
    const created = await createAnime({ title: "Show", description: "Something" });

    const { data } = await api
      .anime({ id: created.id })
      .patch({ description: null }, { headers: admin.headers });

    expect(data?.description).toBeNull();
  });

  it("does not log a request that changes nothing", async () => {
    const created = await createAnime({ title: "Same" });

    const { status } = await api
      .anime({ id: created.id })
      .patch({ title: "Same" }, { headers: admin.headers });

    expect(status).toBe(200);
    expect((await auditFor("anime", created.id)).map((entry) => entry.action)).toEqual([
      "anime.create",
    ]);
  });

  it("rolls the change back if the audit entry cannot be written", async () => {
    // The log is written in the same transaction: no change may exist without its entry
    const created = await createAnime({ title: "Before" });
    const spy = spyOn(AuditRepository, "record").mockRejectedValueOnce(new Error("disk full"));

    const { status } = await api
      .anime({ id: created.id })
      .patch({ title: "After" }, { headers: admin.headers });
    spy.mockRestore();

    expect(status).toBe(500);
    const [row] = await db.select().from(anime).where(eq(anime.id, created.id));
    expect(row?.title).toBe("Before");
  });

  it("validates access and input", async () => {
    const created = await createAnime({ title: "Show", slug: "taken" });
    const other = await createAnime({ title: "Other" });
    const patch = (id: number, body: object, headers = admin.headers) =>
      api.anime({ id }).patch(body as { title: string }, { headers });

    expect((await patch(created.id, { title: "x" }, user.headers)).status).toBe(403);
    expect((await patch(created.id, {})).status).toBe(400);
    expect((await patch(999, { title: "x" })).status).toBe(404);
    expect((await patch(other.id, { slug: "taken" })).status).toBe(409);
  });
});

describe("DELETE /api/anime/:id", () => {
  it("deletes the anime with its episodes and keeps a snapshot in the log", async () => {
    const created = await createAnime({ title: "Gone" });
    await api.anime({ id: created.id }).episodes.post({ number: 1 }, { headers: admin.headers });

    const { status } = await api.anime({ id: created.id }).delete(undefined, {
      headers: admin.headers,
    });

    expect(status).toBe(204);
    expect((await api.anime({ id: created.id }).get()).status).toBe(404);
    expect(await db.select().from(episodes).where(eq(episodes.animeId, created.id))).toEqual([]);

    const deletion = (await auditFor("anime", created.id)).at(-1);
    expect(deletion?.action).toBe("anime.delete");
    expect(deletion?.changes.title).toEqual({ from: "Gone", to: null });
    expect(deletion?.changes.episodeCount).toEqual({ from: 1, to: null });
  });

  it("is admin-only and returns 404 for unknown anime", async () => {
    const created = await createAnime({ title: "Stay" });

    const asUser = await api.anime({ id: created.id }).delete(undefined, { headers: user.headers });
    const unknown = await api.anime({ id: 999 }).delete(undefined, { headers: admin.headers });

    expect(asUser.status).toBe(403);
    expect(unknown.status).toBe(404);
  });
});

describe("episodes", () => {
  it("renumbers and retitles an episode, rejecting a taken number", async () => {
    const created = await createAnime({ title: "Show" });
    const episodesApi = api.anime({ id: created.id }).episodes;
    await episodesApi.post({ number: 1 }, { headers: admin.headers });
    await episodesApi.post({ number: 2 }, { headers: admin.headers });

    const updated = await episodesApi({ number: 2 }).patch(
      { number: 3, title: "Finale" },
      { headers: admin.headers },
    );
    expect(updated.data).toMatchObject({ number: 3, title: "Finale" });

    const conflict = await episodesApi({ number: 3 }).patch(
      { number: 1 },
      { headers: admin.headers },
    );
    expect(conflict.status).toBe(409);

    const missing = await episodesApi({ number: 42 }).patch(
      { title: "x" },
      { headers: admin.headers },
    );
    expect(missing.status).toBe(404);

    const [, update] = await auditFor("episode", updated.data?.id ?? 0);
    expect(update?.changes).toEqual({
      number: { from: 2, to: 3 },
      title: { from: null, to: "Finale" },
    });
  });

  it("deletes an episode and logs it", async () => {
    const created = await createAnime({ title: "Show" });
    const episodesApi = api.anime({ id: created.id }).episodes;
    const { data: episode } = await episodesApi.post({ number: 1 }, { headers: admin.headers });

    const { status } = await episodesApi({ number: 1 }).delete(undefined, {
      headers: admin.headers,
    });

    expect(status).toBe(204);
    expect((await auditFor("episode", episode?.id ?? 0)).map((entry) => entry.action)).toEqual([
      "episode.create",
      "episode.delete",
    ]);
  });
});

describe("GET /api/admin/audit-log", () => {
  it("is available to admins only", async () => {
    expect((await api.admin["audit-log"].get()).status).toBe(401);
    expect((await api.admin["audit-log"].get({ headers: user.headers })).status).toBe(403);
  });

  it("filters by entity and paginates newest first", async () => {
    const created = await createAnime({ title: "v1" });
    for (const title of ["v2", "v3", "v4"]) {
      await api.anime({ id: created.id }).patch({ title }, { headers: admin.headers });
    }
    await createAnime({ title: "Unrelated" });

    const query = { entityType: "anime", entityId: created.id, limit: 3 };
    const first = await api.admin["audit-log"].get({ query, headers: admin.headers });

    expect(first.data?.items.map((entry) => entry.action)).toEqual([
      "anime.update",
      "anime.update",
      "anime.update",
    ]);
    expect(first.data?.items[0]?.changes.title).toEqual({ from: "v3", to: "v4" });
    expect(first.data?.items[0]?.actor).toEqual({ id: admin.id, username: admin.username });

    const second = await api.admin["audit-log"].get({
      query: { ...query, cursor: first.data?.nextCursor ?? undefined },
      headers: admin.headers,
    });
    expect(second.data?.items.map((entry) => entry.action)).toEqual(["anime.create"]);
    expect(second.data?.nextCursor).toBeNull();
  });

  it("keeps the history when the actor's account is deleted", async () => {
    const created = await createAnime({ title: "Orphan" });
    const otherAdmin = await createUser("ADMIN");
    await db.delete(users).where(eq(users.id, admin.id));

    const { data } = await api.admin["audit-log"].get({
      query: { entityType: "anime", entityId: created.id },
      headers: otherAdmin.headers,
    });

    expect(data?.items).toHaveLength(1);
    expect(data?.items[0]?.actor).toBeNull();
  });
});
