import { Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { UsersRepository } from "./users.repository";

export const isAuthenticated = new Elysia({ name: "is-authenticated" })
  .use(
    jwt({
      name: "jwt",
      secret: process.env.JWT_SECRET!,
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
  });
