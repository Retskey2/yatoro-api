import Elysia from "elysia";
import { usersPlugin } from "./users/users.plugin";

export const apiRouter = new Elysia({ prefix: "/api" }).use(usersPlugin);
