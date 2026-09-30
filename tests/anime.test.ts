import { beforeEach, describe, expect, it } from "bun:test";
import { api, createUser, resetDatabase } from "./helpers";

let admin: Awaited<ReturnType<typeof createUser>>;

beforeEach(async () => {
  await resetDatabase();
  admin = await createUser("ADMIN");
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

describe("anime catalog", () => {
  it("creates anime with genres and returns details with sorted episodes", async () => {
    const fantasy = await createGenre("Фэнтези", "fantasy");
    const created = await createAnime({
      title: "Sousou no Frieren",
      status: "RELEASED",
      genreIds: [fantasy.id],
    });

    for (const number of [2, 1]) {
      await api.anime({ id: created.id }).episodes.post({ number }, { headers: admin.headers });
    }

    const { data, status } = await api.anime({ id: created.id }).get();

    expect(status).toBe(200);
    expect(data?.status).toBe("RELEASED");
    expect(data?.genres).toEqual([fantasy]);
    expect(data?.episodes.map((episode) => episode.number)).toEqual([1, 2]);
  });

  it("rejects unknown genres with a helpful error", async () => {
    const { status, error } = await api.anime.post(
      { title: "Unknown", genreIds: [42] },
      { headers: admin.headers },
    );

    expect(status).toBe(400);
    expect(error?.value).toMatchObject({ error: { details: { missingGenreIds: [42] } } });
  });

  it("rejects unsafe poster URLs", async () => {
    const { status } = await api.anime.post(
      { title: "XSS", posterUrl: "javascript:alert(1)" },
      { headers: admin.headers },
    );

    expect(status).toBe(400);
  });

  it("returns 409 for a duplicate episode number (A9 regression)", async () => {
    const created = await createAnime({ title: "Mushishi" });
    const episodes = api.anime({ id: created.id }).episodes;

    expect((await episodes.post({ number: 1 }, { headers: admin.headers })).status).toBe(201);

    const duplicate = await episodes.post({ number: 1 }, { headers: admin.headers });
    expect(duplicate.status).toBe(409);
    expect(duplicate.error?.value).toMatchObject({ error: { code: "CONFLICT" } });
  });

  it("returns 404 when adding an episode to unknown anime", async () => {
    const { status } = await api
      .anime({ id: 999 })
      .episodes.post({ number: 1 }, { headers: admin.headers });

    expect(status).toBe(404);
  });

  it("paginates newest first with a cursor (A10)", async () => {
    for (const title of ["First", "Second", "Third"]) await createAnime({ title });

    const firstPage = await api.anime.get({ query: { limit: 2, sort: "newest" } });
    expect(firstPage.data?.items.map((item) => item.title)).toEqual(["Third", "Second"]);
    expect(firstPage.data?.nextCursor).not.toBeNull();

    const secondPage = await api.anime.get({
      query: { limit: 2, sort: "newest", cursor: firstPage.data?.nextCursor ?? undefined },
    });
    expect(secondPage.data?.items.map((item) => item.title)).toEqual(["First"]);
    expect(secondPage.data?.nextCursor).toBeNull();
  });

  it("caps the page size", async () => {
    const { status } = await api.anime.get({ query: { limit: 1000 } });
    expect(status).toBe(400);
  });
});
