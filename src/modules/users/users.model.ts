import { t } from "elysia";
import { ROLES, type User } from "@/database/schema";

export const PublicUser = t.Object({
  id: t.Integer(),
  username: t.String(),
  role: t.UnionEnum(ROLES),
  createdAt: t.Date(),
});

export const PrivateUser = t.Object({
  ...PublicUser.properties,
  email: t.String(),
});

type ProfileSource = Pick<User, "id" | "username" | "email" | "role" | "createdAt">;

// Explicit mapping: new columns never leak into responses by accident
export const toPublicUser = ({ id, username, role, createdAt }: ProfileSource) => ({
  id,
  username,
  role,
  createdAt,
});

export const toPrivateUser = (user: ProfileSource) => ({
  ...toPublicUser(user),
  email: user.email,
});
