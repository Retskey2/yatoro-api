import { type TSchema, t } from "elysia";
import { BadRequestError } from "./errors";

/**
 * String enum WITHOUT an implicit default. Elysia's `t.UnionEnum` sets `default` to the
 * first value, so an omitted optional field silently turns into it (e.g. `season` → WINTER).
 */
export const StringEnum = <T extends string>(values: readonly T[]) =>
  // t.Union over a mapped array loses literal types, t.Unsafe restores them (schema is unchanged)
  t.Unsafe<T>(t.Union(values.map((value) => t.Literal(value))));

export const IdParams = t.Object({
  id: t.Integer({ minimum: 1 }),
});

export const SlugParams = t.Object({
  slug: t.String({ minLength: 1, maxLength: 120, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
});

export const Page = <T extends TSchema>(item: T) =>
  t.Object({
    items: t.Array(item),
    nextCursor: t.Nullable(t.String()),
  });

/**
 * Opaque keyset cursor: `{ sort, key, id }` of the last row, base64url-encoded.
 * The sort mode is embedded so a cursor cannot be replayed with another ordering.
 */
export interface Cursor {
  sort: string;
  key: string;
  id: number;
}

export const encodeCursor = (cursor: Cursor) =>
  Buffer.from(JSON.stringify([cursor.sort, cursor.key, cursor.id])).toString("base64url");

export function decodeCursor(raw: string, expectedSort: string): Cursor {
  try {
    const [sort, key, id] = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (sort === expectedSort && typeof key === "string" && Number.isInteger(id)) {
      return { sort, key, id };
    }
  } catch {
    // fall through to the error below
  }
  throw new BadRequestError("Некорректный или устаревший курсор");
}

export const bearerAuth = [{ bearerAuth: [] }];
