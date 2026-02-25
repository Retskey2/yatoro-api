import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { UsersRepository } from "./users.repository";
import { isAuthenticated } from "./auth.middleware";
import { success } from "zod";

export const usersPlugin = new Elysia({ prefix: "/users" })
  .use(
    jwt({
      name: "jwt",
      secret: process.env.JWT_SECRET!,
    }),
  )

  .guard({}, (app) =>
    app.use(isAuthenticated).get("/me", ({ user }) => {
      return {
        success: true,
        user,
      };
    }),
  )

  .post(
    "/register",
    async ({ body, jwt, set }) => {
      const existingUser = await UsersRepository.findByEmail(body.email);
      if (existingUser) {
        set.status = 400;
        return { message: "Пользователь с таким email уже существует" };
      }

      const hashedPassword = await Bun.password.hash(body.password);

      const newUser = await UsersRepository.create({
        email: body.email,
        username: body.username,
        passwordHash: hashedPassword,
      });

      const token = await jwt.sign({ id: newUser.id });

      set.status = 201;
      return {
        message: "Успешная регистрация",
        token,
        user: { id: newUser.id, username: newUser.username },
      };
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
      const user = await UsersRepository.findByEmail(body.email);
      if (!user) {
        set.status = 401;
        return { message: "Неверный email или пароль" };
      }

      const isPasswordValid = await Bun.password.verify(
        body.password,
        user.passwordHash,
      );

      if (!isPasswordValid) {
        set.status = 401;
        return { message: "Неверный email или пароль" };
      }

      const token = await jwt.sign({ id: user.id });

      return { token, user: { id: user.id, username: user.username } };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String(),
      }),
    },
  );
