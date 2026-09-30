import { treaty } from "@elysiajs/eden";
import { eq, sql } from "drizzle-orm";
import { app } from "@/app";
import { db } from "@/database";
import { type Role, users } from "@/database/schema";

/** Fully typed client that calls app.handle() directly — no network involved */
export const client = treaty(app);
export const api = client.api;

export async function resetDatabase() {
  await db.execute(
    sql`TRUNCATE users, anime, genres, studios, episodes, anime_genres, anime_studios RESTART IDENTITY CASCADE`,
  );
}

let sequence = 0;

export async function createUser(role: Role = "USER") {
  sequence++;
  const credentials = {
    username: `user_${sequence}`,
    email: `user${sequence}@example.com`,
    password: "correct-horse-battery",
  };

  const { data, error } = await api.auth.register.post(credentials);
  if (error) throw new Error(`Registration failed: ${JSON.stringify(error.value)}`);

  if (role !== "USER") {
    await db.update(users).set({ role }).where(eq(users.id, data.user.id));
  }

  return {
    ...credentials,
    id: data.user.id,
    headers: { authorization: `Bearer ${data.accessToken}` },
  };
}
