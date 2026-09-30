import { sql } from "drizzle-orm";
import { z } from "zod";
import { normalizeEmail } from "@/modules/auth/auth.model";
import { seasonOf } from "@/shared/text";
import type { Database } from "./index";
import {
  type AnimeKind,
  type AnimeStatus,
  anime,
  animeGenres,
  episodes,
  genres,
  users,
} from "./schema";

const GENRES = [
  { name: "Экшен", slug: "action" },
  { name: "Приключения", slug: "adventure" },
  { name: "Комедия", slug: "comedy" },
  { name: "Драма", slug: "drama" },
  { name: "Фэнтези", slug: "fantasy" },
  { name: "Мистика", slug: "mystery" },
  { name: "Психологическое", slug: "psychological" },
  { name: "Фантастика", slug: "sci-fi" },
  { name: "Повседневность", slug: "slice-of-life" },
];

type GenreSlug = (typeof GENRES)[number]["slug"];

/**
 * Small offline demo catalog, so the app works without network access.
 * The full catalog comes from `bun run catalog:import`.
 */
const ANIME: {
  slug: string;
  /** Real Shikimori (= MyAnimeList) id: `catalog:import` updates these rows instead of duplicating */
  shikimoriId: number;
  title: string;
  titleEn: string;
  titleRomaji: string;
  description: string;
  kind: AnimeKind;
  status: AnimeStatus;
  airedOn: string;
  genres: GenreSlug[];
  episodes: number;
}[] = [
  {
    slug: "sousou-no-frieren",
    shikimoriId: 52991,
    title: "Провожающая в последний путь Фрирен",
    titleEn: "Frieren: Beyond Journey's End",
    titleRomaji: "Sousou no Frieren",
    description:
      "Эльфийка-маг переживает своих спутников по приключениям и заново учится ценить время, проведённое с людьми.",
    kind: "TV",
    status: "RELEASED",
    airedOn: "2023-09-29",
    genres: ["adventure", "drama", "fantasy"],
    episodes: 28,
  },
  {
    slug: "mushishi",
    shikimoriId: 457,
    title: "Мастер Муси",
    titleEn: "Mushi-Shi",
    titleRomaji: "Mushishi",
    description:
      "Странствующий знаток муси — загадочных существ на грани жизни — помогает людям, столкнувшимся с их влиянием.",
    kind: "TV",
    status: "RELEASED",
    airedOn: "2005-10-23",
    genres: ["mystery", "slice-of-life", "fantasy"],
    episodes: 26,
  },
  {
    slug: "cowboy-bebop",
    shikimoriId: 1,
    title: "Ковбой Бибоп",
    titleEn: "Cowboy Bebop",
    titleRomaji: "Cowboy Bebop",
    description:
      "Экипаж охотников за головами на корабле «Бибоп» ищет заработок и пытается убежать от собственного прошлого.",
    kind: "TV",
    status: "RELEASED",
    airedOn: "1998-04-03",
    genres: ["action", "sci-fi", "drama"],
    episodes: 26,
  },
  {
    slug: "fullmetal-alchemist-brotherhood",
    shikimoriId: 5114,
    title: "Стальной алхимик: Братство",
    titleEn: "Fullmetal Alchemist: Brotherhood",
    titleRomaji: "Hagane no Renkinjutsushi: Fullmetal Alchemist",
    description:
      "Два брата-алхимика ищут философский камень, чтобы вернуть то, что потеряли из-за запретного ритуала.",
    kind: "TV",
    status: "RELEASED",
    airedOn: "2009-04-05",
    genres: ["action", "adventure", "fantasy", "drama"],
    episodes: 64,
  },
  {
    slug: "steins-gate",
    shikimoriId: 9253,
    title: "Врата Штейна",
    titleEn: "Steins;Gate",
    titleRomaji: "Steins;Gate",
    description:
      "Самопровозглашённый безумный учёный случайно находит способ отправлять сообщения в прошлое — и расплачивается за это.",
    kind: "TV",
    status: "RELEASED",
    airedOn: "2011-04-06",
    genres: ["sci-fi", "psychological", "drama"],
    episodes: 24,
  },
  {
    slug: "spy-x-family",
    shikimoriId: 50265,
    title: "Семья шпиона",
    titleEn: "Spy x Family",
    titleRomaji: "Spy x Family",
    description:
      "Шпион, наёмная убийца и девочка-телепат изображают обычную семью — и у каждого своя тайна.",
    kind: "TV",
    status: "ONGOING",
    airedOn: "2022-04-09",
    genres: ["action", "comedy"],
    episodes: 25,
  },
  {
    slug: "jujutsu-kaisen",
    shikimoriId: 40748,
    title: "Магическая битва",
    titleEn: "Jujutsu Kaisen",
    titleRomaji: "Jujutsu Kaisen",
    description:
      "Школьник проглатывает проклятый предмет и попадает в мир магов, сражающихся с проклятиями.",
    kind: "TV",
    status: "ONGOING",
    airedOn: "2020-10-03",
    genres: ["action", "fantasy"],
    episodes: 24,
  },
];

export interface SeedAdmin {
  username: string;
  email: string;
  password: string;
}

/**
 * Idempotent: the admin is created once, genres are upserted,
 * demo anime are inserted only into an empty catalog.
 */
export async function seed(db: Database, admin: SeedAdmin) {
  const email = normalizeEmail(admin.email);

  const [existingAdmin] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (!existingAdmin) {
    await db.insert(users).values({
      username: admin.username,
      email,
      passwordHash: await Bun.password.hash(admin.password),
      role: "ADMIN",
    });
  }

  await db.insert(genres).values(GENRES).onConflictDoNothing();

  const [catalog] = await db.select({ count: sql<number>`count(*)::int` }).from(anime);
  if ((catalog?.count ?? 0) > 0) {
    return { adminCreated: !existingAdmin, animeCreated: 0 };
  }

  const genreIds = new Map((await db.select().from(genres)).map((genre) => [genre.slug, genre.id]));

  await db.transaction(async (tx) => {
    for (const [
      index,
      { genres: genreSlugs, episodes: episodeCount, ...item },
    ] of ANIME.entries()) {
      const [created] = await tx
        .insert(anime)
        .values({
          ...item,
          ...seasonOf(item.airedOn),
          malId: item.shikimoriId,
          episodesTotal: episodeCount,
          episodesAired: item.status === "RELEASED" ? episodeCount : 0,
          popularityRank: index + 1,
        })
        .returning({ id: anime.id });
      if (!created) throw new Error(`Failed to insert ${item.title}`);

      await tx.insert(animeGenres).values(
        genreSlugs.map((slug) => {
          const genreId = genreIds.get(slug);
          if (genreId === undefined) throw new Error(`Unknown genre: ${slug}`);
          return { animeId: created.id, genreId };
        }),
      );

      await tx.insert(episodes).values(
        Array.from({ length: episodeCount }, (_, episodeIndex) => ({
          animeId: created.id,
          number: episodeIndex + 1,
        })),
      );
    }
  });

  return { adminCreated: !existingAdmin, animeCreated: ANIME.length };
}

if (import.meta.main) {
  const admin = z
    .object({
      SEED_ADMIN_USERNAME: z.string().min(3).default("admin"),
      SEED_ADMIN_EMAIL: z.email(),
      SEED_ADMIN_PASSWORD: z.string().min(8),
    })
    .parse(process.env);

  const { client, db } = await import("./index");

  const result = await seed(db, {
    username: admin.SEED_ADMIN_USERNAME,
    email: admin.SEED_ADMIN_EMAIL,
    password: admin.SEED_ADMIN_PASSWORD,
  });

  console.log(
    `🌱 Seed: админ ${result.adminCreated ? "создан" : "уже был"}, ` +
      `аниме добавлено: ${result.animeCreated}`,
  );
  await client.end();
}
