import { sql } from "drizzle-orm";
import { z } from "zod";
import { normalizeEmail } from "@/modules/auth/auth.model";
import type { Database } from "./index";
import { type AnimeStatus, anime, animeGenres, episodes, genres, users } from "./schema";

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

const ANIME: {
  title: string;
  description: string;
  status: AnimeStatus;
  genres: GenreSlug[];
  episodes: number;
}[] = [
  {
    title: "Провожающая в последний путь Фрирен",
    description:
      "Эльфийка-маг переживает своих спутников по приключениям и заново учится ценить время, проведённое с людьми.",
    status: "RELEASED",
    genres: ["adventure", "drama", "fantasy"],
    episodes: 28,
  },
  {
    title: "Мастер Муси",
    description:
      "Странствующий знаток муси — загадочных существ на грани жизни — помогает людям, столкнувшимся с их влиянием.",
    status: "RELEASED",
    genres: ["mystery", "slice-of-life", "fantasy"],
    episodes: 26,
  },
  {
    title: "Ковбой Бибоп",
    description:
      "Экипаж охотников за головами на корабле «Бибоп» ищет заработок и пытается убежать от собственного прошлого.",
    status: "RELEASED",
    genres: ["action", "sci-fi", "drama"],
    episodes: 26,
  },
  {
    title: "Стальной алхимик: Братство",
    description:
      "Два брата-алхимика ищут философский камень, чтобы вернуть то, что потеряли из-за запретного ритуала.",
    status: "RELEASED",
    genres: ["action", "adventure", "fantasy", "drama"],
    episodes: 64,
  },
  {
    title: "Врата Штейна",
    description:
      "Самопровозглашённый безумный учёный случайно находит способ отправлять сообщения в прошлое — и расплачивается за это.",
    status: "RELEASED",
    genres: ["sci-fi", "psychological", "drama"],
    episodes: 24,
  },
  {
    title: "Семья шпиона",
    description:
      "Шпион, наёмная убийца и девочка-телепат изображают обычную семью — и у каждого своя тайна.",
    status: "ONGOING",
    genres: ["action", "comedy"],
    episodes: 25,
  },
  {
    title: "Магическая битва",
    description:
      "Школьник проглатывает проклятый предмет и попадает в мир магов, сражающихся с проклятиями.",
    status: "ONGOING",
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
    for (const item of ANIME) {
      const [created] = await tx
        .insert(anime)
        .values({ title: item.title, description: item.description, status: item.status })
        .returning({ id: anime.id });
      if (!created) throw new Error(`Failed to insert ${item.title}`);

      await tx.insert(animeGenres).values(
        item.genres.map((slug) => {
          const genreId = genreIds.get(slug);
          if (genreId === undefined) throw new Error(`Unknown genre: ${slug}`);
          return { animeId: created.id, genreId };
        }),
      );

      await tx.insert(episodes).values(
        Array.from({ length: item.episodes }, (_, index) => ({
          animeId: created.id,
          number: index + 1,
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
