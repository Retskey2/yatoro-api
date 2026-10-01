import { Elysia } from "elysia";
import { bearerAuth } from "@/shared/http";
import { authGuard } from "@/shared/plugins/auth";
import { AuditPage, AuditQuery } from "./audit.model";
import { AuditRepository } from "./audit.repository";

export const auditPlugin = new Elysia({ prefix: "/admin/audit-log", tags: ["Admin"] })
  .use(authGuard)

  .get(
    "",
    async ({ query: { limit = 50, ...filters } }) => {
      const rows = await AuditRepository.list({ ...filters, limit });
      const page = rows.slice(0, limit);

      return {
        items: page.map(({ actorId, actorUsername, ...entry }) => ({
          ...entry,
          actor: actorId && actorUsername ? { id: actorId, username: actorUsername } : null,
        })),
        nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
    {
      role: "ADMIN",
      query: AuditQuery,
      response: AuditPage,
      detail: { summary: "Журнал действий администраторов", security: bearerAuth },
    },
  );
