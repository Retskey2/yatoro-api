import { t } from "elysia";
import { PrivateUser } from "@/modules/users/users.model";

export const RegisterBody = t.Object({
  username: t.String({ minLength: 3, maxLength: 32, pattern: "^[a-zA-Z0-9_]+$" }),
  email: t.String({ format: "email", maxLength: 254 }),
  password: t.String({ minLength: 8, maxLength: 128 }),
});

export const LoginBody = t.Object({
  email: t.String({ maxLength: 254 }),
  password: t.String({ maxLength: 128 }),
});

export const AuthResponse = t.Object({
  accessToken: t.String(),
  tokenType: t.Literal("Bearer"),
  user: PrivateUser,
});

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
