import { eq, sql } from "drizzle-orm";
import { db } from "@/database";
import { type NewUser, users } from "@/database/schema";

// Lookups use lower(...) so they hit the case-insensitive unique indexes
export const UsersRepository = {
  findById: async (id: number) => {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  },

  findByEmail: async (email: string) => {
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    return user;
  },

  findByUsername: async (username: string) => {
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`)
      .limit(1);
    return user;
  },

  create: async (data: NewUser) => {
    const [user] = await db.insert(users).values(data).returning();
    if (!user) throw new Error("Insert into users returned no rows");
    return user;
  },
};
