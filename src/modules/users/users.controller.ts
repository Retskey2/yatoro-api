import { Elysia } from "elysia";
import { bearerAuth, IdParams } from "@/shared/http";
import { authGuard } from "@/shared/plugins/auth";
import { PrivateUser, PublicUser, toPrivateUser } from "./users.model";
import { UsersService } from "./users.service";

const usersService = new UsersService();

export const usersPlugin = new Elysia({ prefix: "/users", tags: ["Users"] })
  .use(authGuard)

  .get("/me", ({ user }) => toPrivateUser(user), {
    auth: true,
    response: PrivateUser,
    detail: { summary: "Текущий пользователь", security: bearerAuth },
  })

  .get("/:id", ({ params }) => usersService.getPublicProfile(params.id), {
    params: IdParams,
    response: PublicUser,
    detail: { summary: "Публичный профиль (без email)" },
  });
