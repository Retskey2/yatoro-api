import type { Season } from "@/database/schema";

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

/**
 * URL-friendly slug: transliterates Cyrillic, strips diacritics (ō → o),
 * keeps [a-z0-9] separated by single dashes. Returns "" if nothing is left
 * (e.g. a Japanese-only title) — callers provide a fallback.
 */
export function slugify(input: string, maxLength = 80): string {
  return [...input.toLowerCase()]
    .map((char) => CYRILLIC_TO_LATIN[char] ?? char)
    .join("")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
}

const SEASON_ORDER: Season[] = ["WINTER", "SPRING", "SUMMER", "FALL"];

/**
 * Anime season by premiere date ("YYYY-MM-DD"). Seasons are Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec,
 * but shows premiering in the last ~10 days of a season (e.g. Sep 29) belong to the next one,
 * as in seasonal charts. Used when the source does not provide the season itself.
 */
export function seasonOf(isoDate: string): { year: number; season: Season } {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = isoDate.split("-").map(Number);
  const earlyPremiere = month % 3 === 0 && day >= 20;
  const index = Math.floor((month - 1) / 3) + (earlyPremiere ? 1 : 0);

  return index === 4
    ? { year: year + 1, season: "WINTER" }
    : { year, season: SEASON_ORDER[index] ?? "WINTER" };
}
