import { beforeEach, describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "@/database";
import { anime, genres } from "@/database/schema";
import { CatalogImportService } from "@/modules/catalog-import/catalog-import.service";
import {
  type AnimePageRequest,
  type ShikimoriAnime,
  ShikimoriApiError,
  ShikimoriClient,
} from "@/modules/catalog-import/shikimori.client";
import { cleanDescription, mapShikimoriAnime } from "@/modules/catalog-import/shikimori.mapper";
import { api, resetDatabase } from "./helpers";

// Synthetic entries shaped like the Shikimori GraphQL response
const entry = (overrides: Partial<ShikimoriAnime> = {}): ShikimoriAnime => ({
  id: "1001",
  malId: "1001",
  name: "Hoshi no Kagi",
  russian: "Ключ звезды",
  english: "Key of the Star",
  japanese: "星の鍵",
  synonyms: ["Звёздный ключ", "Key of the Star"],
  kind: "tv",
  status: "released",
  episodes: 12,
  episodesAired: 12,
  duration: 24,
  rating: "pg_13",
  score: 8.12,
  season: "summer_2021",
  airedOn: { date: "2021-07-05", year: 2021 },
  releasedOn: { date: "2021-09-20" },
  poster: { originalUrl: "https://shikimori.io/uploads/poster/animes/1001/x.jpeg" },
  genres: [
    { id: "1", name: "Action", russian: "Экшен", kind: "genre" },
    { id: "27", name: "Shounen", russian: "Сёнен", kind: "demographic" },
  ],
  studios: [{ id: "7", name: "Studio Lumen" }],
  description:
    "Юный [character=5]Акира[/character] [アキラ] находит ключ.\n\n\n[spoiler]Финал[/spoiler]",
  ...overrides,
});

class FakeClient {
  pages: ShikimoriAnime[][] = [];
  requests: AnimePageRequest[] = [];

  async fetchAnimePage(request: AnimePageRequest) {
    this.requests.push(request);
    return this.pages[request.page - 1] ?? [];
  }
}

describe("shikimori mapper", () => {
  it("maps titles, dates and numbers", () => {
    const mapped = mapShikimoriAnime(entry(), 5);

    expect(mapped?.anime).toMatchObject({
      shikimoriId: 1001,
      slug: "1001-hoshi-no-kagi",
      title: "Ключ звезды",
      titleEn: "Key of the Star",
      titleRomaji: "Hoshi no Kagi",
      titleJa: "星の鍵",
      kind: "TV",
      status: "RELEASED",
      ageRating: "PG_13",
      year: 2021,
      season: "SUMMER",
      popularityRank: 5,
    });
    // Synonyms equal to a title are dropped
    expect(mapped?.anime.synonyms).toEqual(["Звёздный ключ"]);
    expect(mapped?.genres.map((genre) => [genre.slug, genre.kind])).toEqual([
      ["action", "GENRE"],
      ["shounen", "DEMOGRAPHIC"],
    ]);
  });

  it("prefers the source's own season over the premiere date", () => {
    // Premiered on Sep 29 but belongs to the fall season
    const mapped = mapShikimoriAnime(
      entry({ season: "fall_2023", airedOn: { date: "2023-09-29", year: 2023 } }),
    );
    expect(mapped?.anime).toMatchObject({ season: "FALL", year: 2023 });
  });

  it("treats zeros from the source as unknown", () => {
    const mapped = mapShikimoriAnime(entry({ score: 0, episodes: 0, duration: 0 }));
    expect(mapped?.anime).toMatchObject({ score: null, episodesTotal: null, durationMin: null });
    expect(mapped?.anime).not.toHaveProperty("popularityRank");
  });

  it("skips explicit content, promo videos and unknown kinds", () => {
    expect(mapShikimoriAnime(entry({ rating: "rx" }))).toBeNull();
    expect(mapShikimoriAnime(entry({ kind: "pv" }))).toBeNull();
    expect(mapShikimoriAnime(entry({ kind: "cm" }))).toBeNull();
  });

  it("cleans description markup", () => {
    expect(cleanDescription(entry().description)).toBe("Юный Акира находит ключ.\n\nФинал");
    expect(cleanDescription("  ")).toBeNull();
  });
});

describe("catalog import", () => {
  let client: FakeClient;
  let service: CatalogImportService;

  beforeEach(async () => {
    await resetDatabase();
    // A genre that already exists locally (e.g. from the seed) must be merged, not duplicated
    await db.insert(genres).values({ name: "Экшен", slug: "action" });
    client = new FakeClient();
    service = new CatalogImportService(client);
  });

  it("imports a page with genres, studios and popularity rank", async () => {
    client.pages = [[entry(), entry({ id: "1002", name: "Second Show", kind: "pv" })]];

    const stats = await service.importPage({ page: 1, limit: 50, order: "popularity" });

    expect(stats).toEqual({ fetched: 2, imported: 1, skipped: 1 });
    const { data } = await api.anime["by-slug"]({ slug: "1001-hoshi-no-kagi" }).get();
    expect(data?.genres.map((genre) => genre.slug).sort()).toEqual(["action", "shounen"]);
    expect(data?.studios.map((studio) => studio.name)).toEqual(["Studio Lumen"]);
    expect(data?.description).toBe("Юный Акира находит ключ.\n\nФинал");

    const [action] = await db.select().from(genres).where(eq(genres.slug, "action"));
    expect(action).toMatchObject({ name: "Экшен", shikimoriId: 1 });
  });

  it("is idempotent and applies updates on re-import", async () => {
    client.pages = [[entry()]];
    await service.importPage({ page: 1, limit: 50, order: "popularity" });

    client.pages = [[entry({ score: 9.01, status: "released", genres: [] })]];
    await service.importPage({ page: 1, limit: 50, order: "popularity" });

    const rows = await db.select().from(anime);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.score).toBeCloseTo(9.01);

    const { data } = await api.anime({ id: rows[0]?.id ?? 0 }).get();
    expect(data?.genres).toEqual([]);
  });

  it("keeps the popularity rank when refreshing by status", async () => {
    client.pages = [[entry()]];
    await service.importPage({ page: 1, limit: 50, order: "popularity" });

    client.pages = [[entry({ status: "ongoing" })]];
    await service.importPage({ page: 1, limit: 50, order: "popularity", status: "ongoing" });

    const [row] = await db.select().from(anime);
    expect(row).toMatchObject({ status: "ONGOING", popularityRank: 1 });
  });

  it("makes imported titles searchable", async () => {
    client.pages = [[entry()]];
    await service.importPage({ page: 1, limit: 50, order: "popularity" });

    const { data } = await api.anime.get({ query: { q: "звёздный ключ" } });
    expect(data?.items.map((item) => item.slug)).toEqual(["1001-hoshi-no-kagi"]);

    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(anime)
      .where(sql`${anime.searchVector} @@ plainto_tsquery('english', 'star')`);
    expect(count).toBe(1);
  });
});

describe("shikimori client", () => {
  const noSleep = async () => {};
  const ok = (animes: unknown[]) =>
    new Response(JSON.stringify({ data: { animes } }), { status: 200 });

  it("identifies itself and retries after 429 honouring Retry-After", async () => {
    const sleeps: number[] = [];
    const calls: Headers[] = [];
    const responses = [
      new Response("", { status: 429, headers: { "retry-after": "3" } }),
      ok([entry()]),
    ];

    const client = new ShikimoriClient({
      userAgent: "Yatoro-test",
      minIntervalMs: 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetch: (async (_input: unknown, init?: RequestInit) => {
        calls.push(new Headers(init?.headers));
        return responses.shift() ?? ok([]);
      }) as unknown as typeof fetch,
    });

    const result = await client.fetchAnimePage({ page: 1, limit: 50, order: "popularity" });

    expect(result).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.get("user-agent")).toBe("Yatoro-test");
    expect(sleeps).toContain(3000);
  });

  it("fails fast on GraphQL errors", async () => {
    let calls = 0;
    const client = new ShikimoriClient({
      userAgent: "Yatoro-test",
      minIntervalMs: 0,
      sleep: noSleep,
      fetch: (async () => {
        calls++;
        return new Response(JSON.stringify({ errors: [{ message: "bad query" }] }));
      }) as unknown as typeof fetch,
    });

    await expect(
      client.fetchAnimePage({ page: 1, limit: 50, order: "popularity" }),
    ).rejects.toBeInstanceOf(ShikimoriApiError);
    expect(calls).toBe(1);
  });

  it("gives up after the configured number of attempts", async () => {
    let calls = 0;
    const client = new ShikimoriClient({
      userAgent: "Yatoro-test",
      minIntervalMs: 0,
      maxAttempts: 3,
      sleep: noSleep,
      fetch: (async () => {
        calls++;
        return new Response("", { status: 503 });
      }) as unknown as typeof fetch,
    });

    await expect(
      client.fetchAnimePage({ page: 1, limit: 50, order: "popularity" }),
    ).rejects.toThrow("after 3 attempts");
    expect(calls).toBe(3);
  });
});
