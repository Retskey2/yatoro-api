import { bigint, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.schema";

export const AUDIT_ACTIONS = [
  "anime.create",
  "anime.update",
  "anime.delete",
  "episode.create",
  "episode.update",
  "episode.delete",
  "genre.create",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** `{ field: { from, to } }` — only changed fields; create/delete record every field from/to null */
export type AuditChanges = Record<string, { from: unknown; to: unknown }>;

/**
 * Append-only log of admin actions. Written in the same transaction as the change itself,
 * so an action without a log entry (or a log entry without the action) cannot exist.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    // The log outlives users: deleting an account keeps its history
    actorId: integer().references(() => users.id, { onDelete: "set null" }),
    action: text().$type<AuditAction>().notNull(),
    entityType: text().notNull(),
    entityId: integer().notNull(),
    changes: jsonb().$type<AuditChanges>().notNull(),
    requestId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.entityType, t.entityId, t.id), index().on(t.actorId, t.id)],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
