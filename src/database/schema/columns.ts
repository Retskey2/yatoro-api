import { integer, timestamp } from "drizzle-orm/pg-core";

export const id = () => integer().primaryKey().generatedAlwaysAsIdentity();

export const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
