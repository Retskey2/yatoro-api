import { type TSchema, t } from "elysia";

export const IdParams = t.Object({
  id: t.Integer({ minimum: 1 }),
});

export const PaginationQuery = t.Object({
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20 })),
  cursor: t.Optional(t.Integer({ minimum: 1 })),
});

export const Page = <T extends TSchema>(item: T) =>
  t.Object({
    items: t.Array(item),
    nextCursor: t.Nullable(t.Integer()),
  });

/**
 * Keyset pagination: the repository fetches `limit + 1` rows,
 * the extra row only tells us whether there is a next page.
 */
export function toPage<T extends { id: number }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    items,
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  };
}

export const bearerAuth = [{ bearerAuth: [] }];
