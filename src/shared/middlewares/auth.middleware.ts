import { type Context, Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";

import { env } from "@/config/env";
import { users } from "@/database/schema";
import { UsersRepository } from "@/modules/users/users.repository";

type SafeUser = Omit<typeof users.$inferSelect, "passwordHash">;
type Role = "USER" | "MODERATOR" | "ADMIN";

export const isAuthenticated = new Elysia({ name: "is-authenticated" })
  .use(
    jwt({
      name: "jwt",
      secret: env.JWT_SECRET!,
    }),
  )
  .derive({ as: "global" }, async ({ headers, jwt, set }) => {
    const authHeader = headers["authorization"];
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      set.status = 401;
      throw new Error("Отсутствует токен авторизации");
    }

    const payload = await jwt.verify(token);
    if (!payload || !payload.id) {
      set.status = 401;
      throw new Error("Невалидный или просроченный токен");
    }

    const user = await UsersRepository.findById(payload.id as number);
    if (!user) {
      set.status = 401;
      throw new Error("Пользователь не найден");
    }

    const { passwordHash, ...safeUser } = user;

    return { user: safeUser };
  })
  .macro(({ onBeforeHandle }) => ({
    isRole(requiredRole: Role) {
      onBeforeHandle(
        ({ user, set }: { user: SafeUser; set: Context["set"] }) => {
          if (!user) {
            set.status = 401;
            return { message: "Не авторизован" };
          }

          if (user.role !== "ADMIN" && user.role !== requiredRole) {
            set.status = 403;
            return { message: "Доступ запрещен. Недостаточно прав." };
          }
        },
      );
    },
  }));
