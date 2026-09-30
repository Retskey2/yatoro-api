import { t } from "elysia";
import type { Genre as GenreRow } from "@/database/schema";

export const Genre = t.Object({
  id: t.Integer(),
  name: t.String(),
  slug: t.String(),
});

export const CreateGenreBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 64 }),
  slug: t.String({ minLength: 1, maxLength: 64, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
});

export const toGenre = ({ id, name, slug }: GenreRow) => ({ id, name, slug });
