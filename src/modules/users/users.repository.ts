import { db } from "@/database";
import { users } from "@/database/schema";
import { eq } from "drizzle-orm";

export const UsersRepository = {
  findByEmail: async (email: string) => {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  },

  create: async (data: typeof users.$inferInsert) => {
    const [newUser] = await db.insert(users).values(data).returning();
    return newUser;
  },

  findById: async (id: number) => {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  },
};
