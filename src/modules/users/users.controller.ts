import { Elysia, t } from "elysia";
import { isAuthenticated } from "@/shared/middlewares/auth.middleware";
import { UsersService } from "./users.service";

const usersService = new UsersService();

export const usersPlugin = new Elysia({ prefix: "/users" })

  .guard({}, (app) =>
    app.use(isAuthenticated).get("/me", ({ user }) => {
      return {
        success: true,
        user,
      };
    }),
  )

  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        const userProfile = await usersService.getUserProfile(params.id);

        return {
          success: true,
          user: userProfile,
        };
      } catch (error: any) {
        set.status = 404;
        return { message: error.message };
      }
    },
    {
      params: t.Object({
        id: t.Numeric(),
      }),
    },
  );
