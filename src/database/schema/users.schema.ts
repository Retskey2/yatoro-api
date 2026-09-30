import { sql } from "drizzle-orm";
import { pgEnum, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { id, timestamps } from "./columns";

export const ROLES = ["USER", "MODERATOR", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const roleEnum = pgEnum("user_role", ROLES);

export const users = pgTable(
  "users",
  {
    id: id(),
    username: text().notNull(),
    email: text().notNull(),
    passwordHash: text().notNull(),
    role: roleEnum().notNull().default("USER"),
    ...timestamps,
  },
  (t) => [
    // Case-insensitive uniqueness: "User@Mail.com" and "user@mail.com" are the same account
    uniqueIndex("users_email_lower_unique").on(sql`lower(${t.email})`),
    uniqueIndex("users_username_lower_unique").on(sql`lower(${t.username})`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
