import { beforeEach, describe, expect, it } from "bun:test";
import { api, createUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

const decodeJwt = (token: string) => {
  const [, payload = ""] = token.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString()) as { sub: string; exp: number };
};

describe("POST /api/auth/register", () => {
  it("creates a user and returns an expiring access token", async () => {
    const { data, status } = await api.auth.register.post({
      username: "frieren",
      email: "Frieren@Example.com",
      password: "long-enough-password",
    });

    expect(status).toBe(201);
    expect(data?.user).toMatchObject({
      username: "frieren",
      email: "frieren@example.com",
      role: "USER",
    });

    // A6: tokens used to live forever
    const claims = decodeJwt(data?.accessToken ?? "");
    expect(claims.sub).toBe(String(data?.user.id));
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it("treats emails case-insensitively (A8)", async () => {
    const existing = await createUser();

    const { status, error } = await api.auth.register.post({
      username: "someone_else",
      email: existing.email.toUpperCase(),
      password: "long-enough-password",
    });

    expect(status).toBe(409);
    expect(error?.value).toMatchObject({ error: { code: "CONFLICT" } });
  });

  it("rejects a taken username without leaking SQL (A7)", async () => {
    const existing = await createUser();

    const { status, error } = await api.auth.register.post({
      username: existing.username.toUpperCase(),
      email: "other@example.com",
      password: "long-enough-password",
    });

    expect(status).toBe(409);
    expect(JSON.stringify(error?.value)).not.toMatch(/insert|select|password_hash|argon2/i);
  });

  it("validates the payload", async () => {
    const { status, error } = await api.auth.register.post({
      username: "no spaces allowed",
      email: "not-an-email",
      password: "short",
    });

    expect(status).toBe(400);
    expect(error?.value).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});

describe("POST /api/auth/login", () => {
  it("logs in with correct credentials, email is case-insensitive", async () => {
    const user = await createUser();

    const { data, status } = await api.auth.login.post({
      email: `  ${user.email.toUpperCase()} `,
      password: user.password,
    });

    expect(status).toBe(200);
    expect(data?.user.id).toBe(user.id);
  });

  it("returns the same error for an unknown email and a wrong password", async () => {
    const user = await createUser();

    const wrongPassword = await api.auth.login.post({ email: user.email, password: "nope-nope" });
    const unknownEmail = await api.auth.login.post({
      email: "ghost@example.com",
      password: "nope-nope",
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.error?.value).toEqual(unknownEmail.error?.value);
  });
});
