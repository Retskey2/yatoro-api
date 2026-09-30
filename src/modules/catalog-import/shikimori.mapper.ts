import type {
  AgeRating,
  AnimeKind,
  AnimeStatus,
  GenreKind,
  NewAnime,
  Season,
} from "@/database/schema";
import { seasonOf, slugify } from "@/shared/text";
import type { ShikimoriAnime } from "./shikimori.client";

const KINDS: Record<string, AnimeKind> = {
  tv: "TV",
  movie: "MOVIE",
  ova: "OVA",
  ona: "ONA",
  special: "SPECIAL",
  tv_special: "SPECIAL",
  music: "MUSIC",
};

const STATUSES: Record<string, AnimeStatus> = {
  anons: "ANNOUNCED",
  ongoing: "ONGOING",
  released: "RELEASED",
};

// "none" → unknown; "rx" (explicit content) is never imported
const RATINGS: Record<string, AgeRating | null> = {
  none: null,
  g: "G",
  pg: "PG",
  pg_13: "PG_13",
  r: "R",
  r_plus: "R_PLUS",
};

const GENRE_KINDS: Record<string, GenreKind> = {
  genre: "GENRE",
  theme: "THEME",
  demographic: "DEMOGRAPHIC",
};

export type ImportedAnime = Omit<NewAnime, "id" | "createdAt" | "updatedAt"> & {
  shikimoriId: number;
};

export interface ImportedGenre {
  shikimoriId: number;
  name: string;
  slug: string;
  kind: GenreKind;
}

export interface ImportedStudio {
  shikimoriId: number;
  name: string;
  slug: string;
}

export interface MappedAnime {
  anime: ImportedAnime;
  genres: ImportedGenre[];
  studios: ImportedStudio[];
}

/**
 * Shikimori descriptions contain BBCode-like markup ([character=1]Name[/character],
 * [spoiler]...[/spoiler]) and original names in brackets ([エレン・イェーガー]).
 * Tags are dropped (their text is kept), bracketed CJK names are removed.
 */
export function cleanDescription(raw: string | null): string | null {
  if (!raw) return null;

  const text = raw
    .replace(/\[\/?[a-z_]+(?:=[^\]]*)?\]/gi, "")
    .replace(/\s*\[[^\]]*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][^\]]*\]/gu, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text || null;
}

const SOURCE_SEASONS: Record<string, Season> = {
  winter: "WINTER",
  spring: "SPRING",
  summer: "SUMMER",
  fall: "FALL",
};

/** The source's own season ("fall_2023") is authoritative; the premiere date is a fallback */
function seasonFromSource(
  season: string | null,
  airedOn: string | null,
  year: number | null,
): { year: number | null; season: Season | null } {
  const match = season?.match(/^(winter|spring|summer|fall)_(\d{4})$/);
  if (match?.[1] && match[2]) {
    return { season: SOURCE_SEASONS[match[1]] ?? null, year: Number(match[2]) };
  }
  return airedOn ? seasonOf(airedOn) : { year, season: null };
}

/** Returns null for entries that must not be imported */
export function mapShikimoriAnime(
  source: ShikimoriAnime,
  popularityRank?: number,
): MappedAnime | null {
  const kind = source.kind ? KINDS[source.kind] : undefined;
  const status = source.status ? STATUSES[source.status] : undefined;
  if (!kind || !status) return null;
  if (source.rating && !(source.rating in RATINGS)) return null;

  const shikimoriId = Number(source.id);
  const title = source.russian || source.english || source.name;
  const titles = new Set([title, source.english, source.name, source.japanese]);
  const airedOn = source.airedOn?.date ?? null;

  const anime: ImportedAnime = {
    shikimoriId,
    malId: source.malId ? Number(source.malId) : null,
    slug: `${shikimoriId}-${slugify(source.name) || "anime"}`,
    title: title.slice(0, 255),
    titleEn: source.english || null,
    titleJa: source.japanese || null,
    titleRomaji: source.name || null,
    synonyms: [...new Set(source.synonyms ?? [])].filter((name) => !titles.has(name)).slice(0, 30),
    description: cleanDescription(source.description),
    posterUrl: source.poster?.originalUrl?.startsWith("https://")
      ? source.poster.originalUrl
      : null,
    kind,
    status,
    ageRating: source.rating ? (RATINGS[source.rating] ?? null) : null,
    // Shikimori uses 0 for "unknown"
    episodesTotal: source.episodes || null,
    episodesAired: source.episodesAired,
    durationMin: source.duration || null,
    score: source.score ? source.score : null,
    airedOn,
    releasedOn: source.releasedOn?.date ?? null,
    ...seasonFromSource(source.season, airedOn, source.airedOn?.year ?? null),
    ...(popularityRank === undefined ? {} : { popularityRank }),
  };

  const genres = (source.genres ?? []).flatMap((genre): ImportedGenre[] => {
    const genreKind = GENRE_KINDS[genre.kind];
    const slug = slugify(genre.name);
    return genreKind && slug
      ? [
          {
            shikimoriId: Number(genre.id),
            name: genre.russian || genre.name,
            slug,
            kind: genreKind,
          },
        ]
      : [];
  });

  const studios = (source.studios ?? []).map((studio) => ({
    shikimoriId: Number(studio.id),
    name: studio.name,
    slug: slugify(studio.name) || `studio-${studio.id}`,
  }));

  return { anime, genres, studios };
}
