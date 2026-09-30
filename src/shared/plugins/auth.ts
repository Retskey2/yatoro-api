import { jwt } from "@elysiajs/jwt";
import { Elysia } from "elysia";
import { env } from "@/config/env";
import type { Role, User } from "@/database/schema";
import { UsersRepository } from "@/modules/users/users.repository";
import { ForbiddenError, UnauthorizedError } from "@/shared/errors";

export type AuthUser = Omit<User, "passwordHash">;

const ROLE_RANK: Record<Role, number> = {
  USER: 0,
  MODERATOR: 1,
  ADMIN: 2,
};

/** Roles are hierarchical: ADMIN can do everything a MODERATOR can, and so on */
export const hasRole = (actual: Role, required: Role) => ROLE_RANK[actual] >= ROLE_RANK[required];

export const jwtPlugin = jwt({
  name: "jwt",
  secret: env.JWT_SECRET,
  exp: env.JWT_ACCESS_TTL,
});

type Verify = (token: string) => Promise<false | { sub?: string }>;

async function authenticate(authorization: string | undefined, verify: Verify): Promise<AuthUser> {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) throw new UnauthorizedError("Отсутствует токен авторизации");

  const payload = await verify(token);
  const userId = Number(payload ? payload.sub : Number.NaN);
  if (!Number.isInteger(userId)) throw new UnauthorizedError("Невалидный или просроченный токен");

  // Loaded on every request on purpose: a role change or ban applies immediately
  const user = await UsersRepository.findById(userId);
  if (!user) throw new UnauthorizedError("Пользователь не найден");

  const { passwordHash: _, ...safeUser } = user;
  return safeUser;
}

/**
 * Declarative route protection (Elysia macro v2):
 *
 *   .get("/me", ({ user }) => user, { auth: true })
 *   .post("/anime", handler, { role: "ADMIN" })
 */
export const authGuard = new Elysia({ name: "auth-guard" }).use(jwtPlugin).macro({
  auth: {
    async resolve({ headers, jwt }) {
      return { user: await authenticate(headers.authorization, (token) => jwt.verify(token)) };
    },
  },
  role: (required: Role) => ({
    async resolve({ headers, jwt }) {
      const user = await authenticate(headers.authorization, (token) => jwt.verify(token));
      if (!hasRole(user.role, required)) throw new ForbiddenError();
      return { user };
    },
  }),
});
