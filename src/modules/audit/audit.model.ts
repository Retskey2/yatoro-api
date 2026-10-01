import { t } from "elysia";
import { AUDIT_ACTIONS } from "@/database/schema";
import { StringEnum } from "@/shared/http";
import type { AuditContext } from "./audit.repository";

export const AuditEntry = t.Object({
  id: t.Integer(),
  action: StringEnum(AUDIT_ACTIONS),
  entityType: t.String(),
  entityId: t.Integer(),
  changes: t.Record(t.String(), t.Object({ from: t.Unknown(), to: t.Unknown() })),
  actor: t.Nullable(t.Object({ id: t.Integer(), username: t.String() })),
  requestId: t.Nullable(t.String()),
  createdAt: t.Date(),
});

export const AuditQuery = t.Object({
  entityType: t.Optional(t.String({ maxLength: 50 })),
  entityId: t.Optional(t.Integer({ minimum: 1 })),
  actorId: t.Optional(t.Integer({ minimum: 1 })),
  action: t.Optional(StringEnum(AUDIT_ACTIONS)),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 50 })),
  cursor: t.Optional(t.Integer({ minimum: 1 })),
});

export const AuditPage = t.Object({
  items: t.Array(AuditEntry),
  nextCursor: t.Nullable(t.Integer()),
});

/** Built in route handlers: the request id ties a log entry to the matching request log line */
export const auditContext = (
  user: { id: number },
  set: { headers: Record<string, unknown> },
): AuditContext => {
  const requestId = set.headers["x-request-id"];
  return { actorId: user.id, requestId: typeof requestId === "string" ? requestId : null };
};
