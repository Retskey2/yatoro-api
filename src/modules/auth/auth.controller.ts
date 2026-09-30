import { Elysia } from "elysia";
import { toPrivateUser } from "@/modules/users/users.model";
import { jwtPlugin } from "@/shared/plugins/auth";
import { AuthResponse, LoginBody, RegisterBody } from "./auth.model";
import { AuthService } from "./auth.service";

const authService = new AuthService();

export const authPlugin = new Elysia({ prefix: "/auth", tags: ["Auth"] })
  .use(jwtPlugin)

  .post(
    "/register",
    async ({ body, jwt, status }) => {
      const user = await authService.register(body);

      return status(201, {
        accessToken: await jwt.sign({ sub: String(user.id) }),
        tokenType: "Bearer" as const,
        user: toPrivateUser(user),
      });
    },
    {
      body: RegisterBody,
      response: { 201: AuthResponse },
      detail: { summary: "Регистрация" },
    },
  )

  .post(
    "/login",
    async ({ body, jwt }) => {
      const user = await authService.login(body.email, body.password);

      return {
        accessToken: await jwt.sign({ sub: String(user.id) }),
        tokenType: "Bearer" as const,
        user: toPrivateUser(user),
      };
    },
    {
      body: LoginBody,
      response: AuthResponse,
      detail: { summary: "Вход по email и паролю" },
    },
  );
