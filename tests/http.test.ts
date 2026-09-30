import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { app } from "@/app";
import { env } from "@/config/env";
import { AnimeRepository } from "@/modules/anime/anime.repository";
import { getClientIp } from "@/shared/plugins/rate-limit";
import { api, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

describe("error handling", () => {
  it("hides internal error details from clients (A7 regression)", async () => {
    const spy = spyOn(AnimeRepository, "search").mockRejectedValueOnce(
      new Error('Failed query: select * from "users" params: secret'),
    );

    const response = await app.handle(new Request("http://localhost/api/anime"));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Внутренняя ошибка сервера" },
    });
    expect(body).not.toContain("Failed query");
    spy.mockRestore();
  });

  it("returns a uniform 404 for unknown routes", async () => {
    const response = await app.handle(new Request("http://localhost/api/nope"));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "ROUTE_NOT_FOUND" } });
  });

  it("returns 400 for a malformed JSON body", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
      }),
    );

    expect(response.status).toBe(400);
  });
});

describe("getClientIp (A5 regression)", () => {
  const server = { requestIP: () => ({ address: "203.0.113.7" }) };

  it("ignores client-controlled headers by default", () => {
    const request = new Request("http://localhost/", {
      headers: { "x-api-key": "random", "x-forwarded-for": "1.1.1.1" },
    });

    expect(getClientIp(request, server, false)).toBe("203.0.113.7");
  });

  it("behind a trusted proxy uses the last X-Forwarded-For hop (the one our proxy added)", () => {
    const request = new Request("http://localhost/", {
      headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.4" },
    });

    expect(getClientIp(request, server, true)).toBe("198.51.100.4");
  });
});

describe("rate limiting", () => {
  beforeEach(() => {
    env.RATE_LIMIT_ENABLED = true;
  });

  afterEach(() => {
    env.RATE_LIMIT_ENABLED = false;
  });

  it("cannot be bypassed by rotating the x-api-key header (A5 regression)", async () => {
    const attempt = (i: number) =>
      api.auth.login.post(
        { email: "victim@example.com", password: `guess-${i}` },
        { headers: { "x-api-key": `rotating-${i}` } },
      );

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await attempt(i)).status);

    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
