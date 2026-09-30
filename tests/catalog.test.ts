import { beforeAll, describe, expect, it } from "bun:test";
import { db } from "@/database";
import { seed } from "@/database/seed";
import { api, resetDatabase } from "./helpers";

// Read-only tests over the 7 seeded titles
beforeAll(async () => {
  await resetDatabase();
  await seed(db, { username: "admin", email: "admin@yatoro.local", password: "admin-password" });
});

type Query = NonNullable<Parameters<typeof api.anime.get>[0]>["query"];

const titles = async (query: Query) => {
  const { data, error } = await api.anime.get({ query });
  if (error) throw new Error(JSON.stringify(error.value));
  return data.items.map((item) => item.slug);
};

describe("search", () => {
  it("tolerates typos (trigram similarity)", async () => {
    expect((await titles({ q: "фрирэн" }))[0]).toBe("sousou-no-frieren");
  });

  it("finds Russian word forms (full-text with stemming)", async () => {
    expect(await titles({ q: "алхимики" })).toContain("fullmetal-alchemist-brotherhood");
  });

  it("searches English and romaji titles too", async () => {
    expect((await titles({ q: "cowboy" }))[0]).toBe("cowboy-bebop");
    expect((await titles({ q: "sousou" }))[0]).toBe("sousou-no-frieren");
  });

  it("returns nothing for unrelated input", async () => {
    expect(await titles({ q: "zzqxwv" })).toEqual([]);
  });

  it("requires q for relevance sorting", async () => {
    const { status } = await api.anime.get({ query: { sort: "relevance" } });
    expect(status).toBe(400);
  });
});

describe("filters", () => {
  it("does not apply hidden defaults when filters are omitted", async () => {
    // Regression: t.UnionEnum sets default = first value, so `season` became WINTER
    expect(await titles({})).toHaveLength(7);
  });

  it("requires ALL requested genres", async () => {
    const result = await titles({ genres: ["action", "fantasy"] });
    expect(result.sort()).toEqual(["fullmetal-alchemist-brotherhood", "jujutsu-kaisen"]);
  });

  it("filters by season and year range", async () => {
    const result = await titles({ season: "SPRING", yearFrom: 2009, yearTo: 2011 });
    expect(result.sort()).toEqual(["fullmetal-alchemist-brotherhood", "steins-gate"]);
  });

  it("filters by status", async () => {
    const result = await titles({ status: ["ONGOING"] });
    expect(result.sort()).toEqual(["jujutsu-kaisen", "spy-x-family"]);
  });

  it("rejects an inverted year range", async () => {
    const { status } = await api.anime.get({ query: { yearFrom: 2020, yearTo: 2010 } });
    expect(status).toBe(400);
  });
});

describe("sorting and cursor pagination", () => {
  const walk = async (query: Query) => {
    const seen: string[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < 10; page++) {
      const { data, error } = await api.anime.get({ query: { ...query, limit: 3, cursor } });
      if (error) throw new Error(JSON.stringify(error.value));
      seen.push(...data.items.map((item) => item.slug));
      if (!data.nextCursor) break;
      cursor = data.nextCursor;
    }

    return seen;
  };

  for (const sort of ["popular", "score", "newest", "title"] as const) {
    it(`walks every title exactly once with sort=${sort}`, async () => {
      const seen = await walk({ sort });
      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
    });
  }

  it("orders by popularity by default and by air date for newest", async () => {
    expect((await titles({}))[0]).toBe("sousou-no-frieren");
    expect((await titles({ sort: "newest" })).slice(0, 2)).toEqual([
      "sousou-no-frieren",
      "spy-x-family",
    ]);
  });

  it("rejects a cursor issued for another sort mode", async () => {
    const { data } = await api.anime.get({ query: { sort: "popular", limit: 2 } });
    const { status } = await api.anime.get({
      query: { sort: "title", cursor: data?.nextCursor ?? "" },
    });
    expect(status).toBe(400);
  });

  it("rejects a tampered cursor", async () => {
    const { status } = await api.anime.get({ query: { cursor: "not-a-cursor" } });
    expect(status).toBe(400);
  });
});

describe("details", () => {
  it("finds anime by slug with derived year and season", async () => {
    const { data, status } = await api.anime["by-slug"]({ slug: "cowboy-bebop" }).get();

    expect(status).toBe(200);
    expect(data).toMatchObject({ year: 1998, season: "SPRING", kind: "TV", episodesTotal: 26 });
    expect(data).not.toHaveProperty("searchVector");
  });

  it("returns genres on catalog cards", async () => {
    const { data } = await api.anime.get({ query: { q: "бибоп" } });
    expect(data?.items[0]?.genres.map((genre) => genre.slug).sort()).toEqual([
      "action",
      "drama",
      "sci-fi",
    ]);
  });
});
