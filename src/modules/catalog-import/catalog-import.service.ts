import { inArray, type SQL, sql } from "drizzle-orm";
import { db } from "@/database";
import { anime, animeGenres, animeStudios, genres, studios } from "@/database/schema";
import type { AnimePageRequest, ShikimoriClient } from "./shikimori.client";
import { type ImportedStudio, type MappedAnime, mapShikimoriAnime } from "./shikimori.mapper";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const uniqueBy = <T>(items: T[], key: (item: T) => unknown) => [
  ...new Map(items.map((item) => [key(item), item])).values(),
];

const snakeCase = (name: string) => name.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);

/** `SET col = excluded.col` for every imported column (upsert overwrites with fresh data) */
const updateFromExcluded = (columns: string[]) =>
  Object.fromEntries([
    ...columns.map((column): [string, SQL] => [column, sql.raw(`excluded."${snakeCase(column)}"`)]),
    ["updatedAt", sql`now()`],
  ]);

export interface ImportStats {
  fetched: number;
  imported: number;
  skipped: number;
}

/**
 * Idempotent import: re-running updates existing rows (matched by shikimori_id)
 * instead of creating duplicates. One page = one transaction.
 */
export class CatalogImportService {
  constructor(private readonly client: Pick<ShikimoriClient, "fetchAnimePage">) {}

  async importPage(request: AnimePageRequest): Promise<ImportStats> {
    const items = await this.client.fetchAnimePage(request);

    // The global popularity position is only known when walking the whole list by popularity
    const rankOffset =
      request.order === "popularity" && !request.status
        ? (request.page - 1) * request.limit
        : undefined;

    const mapped = items.flatMap((item, index) => {
      const result = mapShikimoriAnime(
        item,
        rankOffset === undefined ? undefined : rankOffset + index + 1,
      );
      return result ? [result] : [];
    });

    await this.save(mapped);
    return {
      fetched: items.length,
      imported: mapped.length,
      skipped: items.length - mapped.length,
    };
  }

  async save(items: MappedAnime[]) {
    const unique = uniqueBy(items, (item) => item.anime.shikimoriId);
    if (unique.length === 0) return;

    await db.transaction(async (tx) => {
      const genreIds = await upsertGenres(tx, unique);
      const studioIds = await upsertStudios(tx, unique);

      const rows = unique.map((item) => item.anime);
      const columns = Object.keys(rows[0] ?? {}).filter((column) => column !== "shikimoriId");

      const saved = await tx
        .insert(anime)
        .values(rows)
        .onConflictDoUpdate({ target: anime.shikimoriId, set: updateFromExcluded(columns) })
        .returning({ id: anime.id, shikimoriId: anime.shikimoriId });

      const animeIds = new Map(saved.map((row) => [row.shikimoriId, row.id]));
      const ids = [...animeIds.values()];

      // Relations are replaced as a whole: the source is the truth for imported titles
      await tx.delete(animeGenres).where(inArray(animeGenres.animeId, ids));
      await tx.delete(animeStudios).where(inArray(animeStudios.animeId, ids));

      const genreLinks = unique.flatMap((item) =>
        uniqueBy(item.genres, (genre) => genre.shikimoriId).flatMap((genre) => {
          const animeId = animeIds.get(item.anime.shikimoriId);
          const genreId = genreIds.get(genre.shikimoriId);
          return animeId && genreId ? [{ animeId, genreId }] : [];
        }),
      );
      const studioLinks = unique.flatMap((item) =>
        uniqueBy(item.studios, (studio) => studio.shikimoriId).flatMap((studio) => {
          const animeId = animeIds.get(item.anime.shikimoriId);
          const studioId = studioIds.get(studio.shikimoriId);
          return animeId && studioId ? [{ animeId, studioId }] : [];
        }),
      );

      if (genreLinks.length > 0) await tx.insert(animeGenres).values(genreLinks);
      if (studioLinks.length > 0) await tx.insert(animeStudios).values(studioLinks);
    });
  }
}

/** Matched by slug, so genres created by hand or by the seed merge with the imported ones */
async function upsertGenres(tx: Transaction, items: MappedAnime[]) {
  const rows = uniqueBy(
    items.flatMap((item) => item.genres),
    (genre) => genre.slug,
  );
  if (rows.length === 0) return new Map<number, number>();

  const saved = await tx
    .insert(genres)
    .values(rows)
    .onConflictDoUpdate({
      target: genres.slug,
      set: updateFromExcluded(["name", "kind", "shikimoriId"]),
    })
    .returning({ id: genres.id, shikimoriId: genres.shikimoriId });

  return new Map(saved.flatMap((row) => (row.shikimoriId ? [[row.shikimoriId, row.id]] : [])));
}

async function upsertStudios(tx: Transaction, items: MappedAnime[]) {
  const rows = uniqueBy(
    items.flatMap((item) => item.studios),
    (studio) => studio.shikimoriId,
  );
  if (rows.length === 0) return new Map<number, number>();

  // Different studios may produce the same slug: keep the first owner, suffix the rest
  const taken = await tx
    .select({ slug: studios.slug, shikimoriId: studios.shikimoriId })
    .from(studios)
    .where(
      inArray(
        studios.slug,
        rows.map((studio) => studio.slug),
      ),
    );
  const owners = new Map(taken.map((row) => [row.slug, row.shikimoriId]));

  const withUniqueSlugs = rows.map((studio): ImportedStudio => {
    const owner = owners.get(studio.slug);
    if (owner !== undefined && owner !== studio.shikimoriId) {
      return { ...studio, slug: `${studio.slug}-${studio.shikimoriId}` };
    }
    owners.set(studio.slug, studio.shikimoriId);
    return studio;
  });

  const saved = await tx
    .insert(studios)
    .values(withUniqueSlugs)
    .onConflictDoUpdate({ target: studios.shikimoriId, set: updateFromExcluded(["name"]) })
    .returning({ id: studios.id, shikimoriId: studios.shikimoriId });

  return new Map(saved.flatMap((row) => (row.shikimoriId ? [[row.shikimoriId, row.id]] : [])));
}
