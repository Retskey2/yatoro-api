import { and, desc, eq, lt, type SQL } from "drizzle-orm";
import { db, type Executor } from "@/database";
import { type AuditAction, type AuditChanges, auditLog, users } from "@/database/schema";

/** Who did it and within which request — passed from the route handler down to the repository */
export interface AuditContext {
  actorId: number;
  requestId: string | null;
}

export interface AuditRecord extends AuditContext {
  action: AuditAction;
  entityType: string;
  entityId: number;
  changes: AuditChanges;
}

const normalize = (value: unknown) =>
  value instanceof Date ? value.toISOString() : value === undefined ? null : value;

/** Field-level diff: only keys whose (JSON) value changed */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditChanges {
  const changes: AuditChanges = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const from = normalize(before[key]);
    const to = normalize(after[key]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
  }

  return changes;
}

export const AuditRepository = {
  /** Must be called with the transaction that performs the change itself */
  record: async (executor: Executor, entry: AuditRecord) => {
    await executor.insert(auditLog).values(entry);
  },

  list: async (filters: {
    entityType?: string;
    entityId?: number;
    actorId?: number;
    action?: AuditAction;
    cursor?: number;
    limit: number;
  }) => {
    const conditions: SQL[] = [];
    if (filters.entityType) conditions.push(eq(auditLog.entityType, filters.entityType));
    if (filters.entityId !== undefined) conditions.push(eq(auditLog.entityId, filters.entityId));
    if (filters.actorId !== undefined) conditions.push(eq(auditLog.actorId, filters.actorId));
    if (filters.action) conditions.push(eq(auditLog.action, filters.action));
    if (filters.cursor !== undefined) conditions.push(lt(auditLog.id, filters.cursor));

    return await db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        changes: auditLog.changes,
        requestId: auditLog.requestId,
        createdAt: auditLog.createdAt,
        actorId: users.id,
        actorUsername: users.username,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(and(...conditions))
      .orderBy(desc(auditLog.id))
      .limit(filters.limit + 1);
  },
};
