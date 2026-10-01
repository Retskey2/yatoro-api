import { and, asc, desc, eq, gte, inArray, lte, type SQL, sql } from "drizzle-orm";
import { db, type Transaction } from "@/database";
import {
  type AnimeKind,
  type AnimeStatus,
  anime,
  animeGenres,
  episodes,
  genres,
  type NewAnime,
  type Season,
} from "@/database/schema";
import { type AuditContext, AuditRepository, diffFields } from "@/modules/audit/audit.repository";
import { scheduleEpisodeFilesCleanup } from "@/modules/video/video.cleanup";
import type { Cursor } from "@/shared/http";
import type { CatalogSort } from "./anime.model";

export interface CatalogFilters {
  q?: string;
  genres?: string[];
  kind?: AnimeKind[];
  status?: AnimeStatus[];
  season?: Season;
  yearFrom?: number;
  yearTo?: number;
  scoreMin?: number;
}

const summaryColumns = {
  id: anime.id,
  slug: anime.slug,
  title: anime.title,
  titleEn: anime.titleEn,
  posterUrl: anime.posterUrl,
  kind: anime.kind,
  status: anime.status,
  year: anime.year,
  season: anime.season,
  score: anime.score,
  episodesTotal: anime.episodesTotal,
  episodesAired: anime.episodesAired,
};

// Genres for catalog cards in the same query: one correlated subquery instead of N+1.
// The outer column is qualified by hand: in a single-table select Drizzle renders
// ${anime.id} as a bare "id", which inside the subquery would bind to g.id instead.
const genresJson = sql<{ id: number; name: string; slug: string }[]>`coalesce((
  select json_agg(json_build_object('id', g.id, 'name', g.name, 'slug', g.slug) order by g.name)
  from ${animeGenres} ag join ${genres} g on g.id = ag.genre_id
  where ag.anime_id = "anime"."id"
), '[]'::json)`;

const tsQuery = (q: string) =>
  sql`(websearch_to_tsquery('russian', ${q}) || websearch_to_tsquery('english', ${q}) || websearch_to_tsquery('simple', ${q}))`;

/**
 * Sort key per mode. NULLs are mapped to sentinels so the key is total and
 * keyset comparison `(key, id) > (cursorKey, cursorId)` stays correct.
 * `cast` restores the key type from its text form stored in the cursor.
 */
function sortSpec(sort: CatalogSort, q: string | undefined) {
  switch (sort) {
    case "popular":
      return {
        key: sql`coalesce(${anime.popularityRank}, 2147483647)`,
        dir: "asc",
        cast: "integer",
      } as const;
    case "score":
      return { key: sql`coalesce(${anime.score}, -1)`, dir: "desc", cast: "real" } as const;
    case "newest":
      return {
        key: sql`coalesce(${anime.airedOn}, '0001-01-01'::date)`,
        dir: "desc",
        cast: "date",
      } as const;
    case "title":
      return { key: sql`${anime.title}`, dir: "asc", cast: "text" } as const;
    case "relevance": {
      // Full-text rank (stemming, title weights) + trigram similarity (typos, word forms).
      // Rounded to numeric so the value survives the round trip through the cursor exactly.
      const rank = sql`round((ts_rank_cd(${anime.searchVector}, ${tsQuery(q ?? "")}, 32) + word_similarity(${q ?? ""}, ${anime.searchText}))::numeric, 6)`;
      return { key: rank, dir: "desc", cast: "numeric" } as const;
    }
  }
}

function filtersToSql(filters: CatalogFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.q) {
    conditions.push(
      // Both sides are indexable (GIN tsvector + GIN trigram), so Postgres can combine them
      // with a BitmapOr instead of computing word_similarity() for every row.
      // `<%` uses pg_trgm.word_similarity_threshold, see database/search.ts
      sql`(${anime.searchVector} @@ ${tsQuery(filters.q)} or ${filters.q} <% ${anime.searchText})`,
    );
  }

  if (filters.genres?.length) {
    // AND semantics: the anime must have every requested genre
    const withAllGenres = db
      .select({ animeId: animeGenres.animeId })
      .from(animeGenres)
      .innerJoin(genres, eq(genres.id, animeGenres.genreId))
      .where(inArray(genres.slug, filters.genres))
      .groupBy(animeGenres.animeId)
      .having(sql`count(*) = ${filters.genres.length}`);
    conditions.push(inArray(anime.id, withAllGenres));
  }

  if (filters.kind?.length) conditions.push(inArray(anime.kind, filters.kind));
  if (filters.status?.length) conditions.push(inArray(anime.status, filters.status));
  if (filters.season) conditions.push(eq(anime.season, filters.season));
  if (filters.yearFrom !== undefined) conditions.push(gte(anime.year, filters.yearFrom));
  if (filters.yearTo !== undefined) conditions.push(lte(anime.year, filters.yearTo));
  if (filters.scoreMin !== undefined) conditions.push(gte(anime.score, filters.scoreMin));

  return conditions;
}

export const AnimeRepository = {
  /** Returns up to `limit + 1` rows: the extra one only signals that a next page exists */
  search: async (options: {
    filters: CatalogFilters;
    sort: CatalogSort;
    limit: number;
    cursor?: Cursor;
  }) => {
    const spec = sortSpec(options.sort, options.filters.q);
    const conditions = filtersToSql(options.filters);

    if (options.cursor) {
      const op = spec.dir === "asc" ? sql`>` : sql`<`;
      conditions.push(
        sql`(${spec.key}, ${anime.id}) ${op} (${options.cursor.key}::${sql.raw(spec.cast)}, ${options.cursor.id})`,
      );
    }

    const order =
      spec.dir === "asc" ? [asc(spec.key), asc(anime.id)] : [desc(spec.key), desc(anime.id)];

    return await db
      .select({ ...summaryColumns, genres: genresJson, sortKey: sql<string>`(${spec.key})::text` })
      .from(anime)
      .where(and(...conditions))
      .orderBy(...order)
      .limit(options.limit + 1);
  },

  getById: async (id: number) => findDetails(eq(anime.id, id)),

  getBySlug: async (slug: string) => findDetails(eq(anime.slug, slug)),

  exists: async (id: number) => {
    const [row] = await db.select({ id: anime.id }).from(anime).where(eq(anime.id, id)).limit(1);
    return row !== undefined;
  },

  create: async (data: NewAnime, genreIds: number[], audit: AuditContext) => {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(anime).values(data).returning(summaryColumns);
      if (!created) throw new Error("Insert into anime returned no rows");

      await replaceGenres(tx, created.id, genreIds);

      await AuditRepository.record(tx, {
        ...audit,
        action: "anime.create",
        entityType: "anime",
        entityId: created.id,
        changes: diffFields({}, (await snapshot(tx, created.id)) ?? {}),
      });

      return created;
    });
  },

  /** `genreIds: undefined` keeps genres as they are, `[]` removes all. Returns false if not found */
  update: async (
    id: number,
    patch: Partial<NewAnime>,
    genreIds: number[] | undefined,
    audit: AuditContext,
  ) => {
    return await db.transaction(async (tx) => {
      // Row lock: a concurrent edit waits, so the logged diff is exactly what this request changed
      const before = await snapshot(tx, id, { lock: true });
      if (!before) return false;

      if (Object.keys(patch).length > 0) {
        await tx.update(anime).set(patch).where(eq(anime.id, id));
      }
      if (genreIds) await replaceGenres(tx, id, genreIds);

      const changes = diffFields(before, (await snapshot(tx, id)) ?? {});
      // A no-op request (same values) leaves no trace in the log
      if (Object.keys(changes).length > 0) {
        await AuditRepository.record(tx, {
          ...audit,
          action: "anime.update",
          entityType: "anime",
          entityId: id,
          changes,
        });
      }

      return true;
    });
  },

  /**
   * Episodes and genre links go with it (ON DELETE CASCADE), their files are scheduled for
   * deletion in the same transaction. Returns false if not found
   */
  delete: async (id: number, audit: AuditContext) => {
    return await db.transaction(async (tx) => {
      const before = await snapshot(tx, id, { lock: true });
      if (!before) return false;

      const episodeIds = (
        await tx.select({ id: episodes.id }).from(episodes).where(eq(episodes.animeId, id))
      ).map((episode) => episode.id);

      await tx.delete(anime).where(eq(anime.id, id));
      await scheduleEpisodeFilesCleanup(tx, episodeIds);

      await AuditRepository.record(tx, {
        ...audit,
        action: "anime.delete",
        entityType: "anime",
        entityId: id,
        changes: diffFields({ ...before, episodeCount: episodeIds.length }, {}),
      });

      return true;
    });
  },
};

// What the audit log records about an anime: everything an admin or the import can change
const snapshotColumns = {
  slug: anime.slug,
  title: anime.title,
  titleEn: anime.titleEn,
  titleJa: anime.titleJa,
  titleRomaji: anime.titleRomaji,
  synonyms: anime.synonyms,
  description: anime.description,
  posterUrl: anime.posterUrl,
  kind: anime.kind,
  status: anime.status,
  ageRating: anime.ageRating,
  episodesTotal: anime.episodesTotal,
  episodesAired: anime.episodesAired,
  durationMin: anime.durationMin,
  score: anime.score,
  airedOn: anime.airedOn,
  releasedOn: anime.releasedOn,
  year: anime.year,
  season: anime.season,
  shikimoriId: anime.shikimoriId,
};

async function snapshot(tx: Transaction, id: number, options: { lock?: boolean } = {}) {
  const query = tx.select(snapshotColumns).from(anime).where(eq(anime.id, id));
  const [row] = options.lock ? await query.for("update") : await query;
  if (!row) return undefined;

  const genreRows = await tx
    .select({ slug: genres.slug })
    .from(animeGenres)
    .innerJoin(genres, eq(genres.id, animeGenres.genreId))
    .where(eq(animeGenres.animeId, id))
    .orderBy(asc(genres.slug));

  return { ...row, genres: genreRows.map((genre) => genre.slug) };
}

async function replaceGenres(tx: Transaction, animeId: number, genreIds: number[]) {
  await tx.delete(animeGenres).where(eq(animeGenres.animeId, animeId));
  if (genreIds.length > 0) {
    await tx.insert(animeGenres).values(genreIds.map((genreId) => ({ animeId, genreId })));
  }
}

function findDetails(where: SQL) {
  return db.query.anime.findFirst({
    where,
    columns: { searchVector: false, searchText: false },
    with: {
      episodes: { orderBy: (episode, { asc }) => [asc(episode.number)] },
      animeGenres: { with: { genre: true } },
      animeStudios: { with: { studio: true } },
    },
  });
}

export type AnimeSummaryRow = Awaited<ReturnType<typeof AnimeRepository.create>>;
