import { beforeEach, describe, expect, it } from "bun:test";
import { app } from "@/app";
import { api, createUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

describe("users", () => {
  it("GET /me returns the private profile", async () => {
    const user = await createUser();
    const { data, status } = await api.users.me.get({ headers: user.headers });

    expect(status).toBe(200);
    expect(data).toMatchObject({ id: user.id, email: user.email });
    expect(data).not.toHaveProperty("passwordHash");
  });

  it("GET /:id does not expose email (A4 regression)", async () => {
    const user = await createUser();
    const { data, status } = await api.users({ id: user.id }).get();

    expect(status).toBe(200);
    expect(data).toMatchObject({ id: user.id, username: user.username });
    expect(data).not.toHaveProperty("email");
    expect(data).not.toHaveProperty("passwordHash");
  });

  it("GET /:id returns 404 for an unknown user", async () => {
    const { status, error } = await api.users({ id: 999 }).get();

    expect(status).toBe(404);
    expect(error?.value).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("GET /:id validates the id", async () => {
    const response = await app.handle(new Request("http://localhost/api/users/abc"));
    expect(response.status).toBe(400);
  });
});
