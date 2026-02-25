import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { AuthService } from "./auth.service";

const authService = new AuthService();

export const authPlugin = new Elysia({ prefix: "/auth" })
  .use(
    jwt({
      name: "jwt",
      secret: process.env.JWT_SECRET!,
    }),
  )

  .post(
    "/register",
    async ({ body, jwt, set }) => {
      try {
        const newUser = await authService.register({
          email: body.email,
          username: body.username,
          password: body.password,
          passwordHash: "",
        });

        const token = await jwt.sign({ id: newUser.id });

        set.status = 201;
        return {
          message: "Успешная регистрация",
          token,
          user: { id: newUser.id, username: newUser.username },
        };
      } catch (error: any) {
        set.status = 400;
        return { message: error.message };
      }
    },
    {
      body: t.Object({
        username: t.String({ minLength: 3 }),
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 6 }),
      }),
    },
  )

  .post(
    "/login",
    async ({ body, jwt, set }) => {
      try {
        const user = await authService.login(body.email, body.password);

        const token = await jwt.sign({ id: user.id });

        return { token, user: { id: user.id, username: user.username } };
      } catch (error: any) {
        set.status = 401;
        return { message: error.message };
      }
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String(),
      }),
    },
  );
