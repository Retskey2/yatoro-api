import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { sql } from "drizzle-orm";
import { app } from "@/app";
import { db } from "@/database";
import { seed } from "@/database/seed";
import { api, client, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

describe("GET /health", () => {
  it("reports ok when the database is reachable", async () => {
    const { status, data } = await client.health.get();

    expect(status).toBe(200);
    expect(data).toMatchObject({ status: "ok", database: "up" });
  });

  it("returns 503 when the database is down", async () => {
    const spy = spyOn(db, "execute").mockRejectedValueOnce(new Error("connection refused"));

    const response = await app.handle(new Request("http://localhost/health"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "degraded", database: "down" });
    spy.mockRestore();
  });
});

describe("seed", () => {
  const admin = { username: "admin", email: "Admin@Yatoro.local", password: "seed-admin-password" };

  const count = async (table: string) => {
    const result = await db.execute<{ count: number }>(
      sql.raw(`select count(*)::int as count from ${table}`),
    );
    // postgres-js returns an array, PGlite returns { rows }
    const rows = Array.isArray(result) ? result : (result as { rows: { count: number }[] }).rows;
    return rows[0]?.count;
  };

  it("fills an empty database and is idempotent", async () => {
    const first = await seed(db, admin);
    const snapshot = [await count("anime"), await count("genres"), await count("episodes")];

    const second = await seed(db, admin);

    expect(first).toEqual({ adminCreated: true, animeCreated: 7 });
    expect(second).toEqual({ adminCreated: false, animeCreated: 0 });
    expect([await count("anime"), await count("genres"), await count("episodes")]).toEqual(
      snapshot,
    );
    expect(await count("users")).toBe(1);
  });

  it("creates a working admin account", async () => {
    await seed(db, admin);

    const { data } = await api.auth.login.post({ email: admin.email, password: admin.password });
    expect(data?.user.role).toBe("ADMIN");

    const created = await api.genres.post(
      { name: "Меха", slug: "mecha" },
      { headers: { authorization: `Bearer ${data?.accessToken}` } },
    );
    expect(created.status).toBe(201);
    expect(created.data?.name).toBe("Меха");
  });

  it("links seeded anime with genres and episodes", async () => {
    await seed(db, admin);

    const { data: page } = await api.anime.get({ query: { limit: 100 } });
    const frieren = page?.items.find((item) => item.title.includes("Фрирен"));
    const { data: details } = await api.anime({ id: frieren?.id ?? 0 }).get();

    expect(details?.genres.map((genre) => genre.slug).sort()).toEqual([
      "adventure",
      "drama",
      "fantasy",
    ]);
    expect(details?.episodes).toHaveLength(28);
  });
});
