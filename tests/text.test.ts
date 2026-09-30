import { describe, expect, it } from "bun:test";
import { seasonOf, slugify } from "@/shared/text";

describe("slugify", () => {
  it("transliterates Cyrillic and strips diacritics", () => {
    expect(slugify("Магическая битва")).toBe("magicheskaya-bitva");
    expect(slugify("Ёжик в тумане")).toBe("ezhik-v-tumane");
    expect(slugify("Kōkaku Kidōtai")).toBe("kokaku-kidotai");
  });

  it("collapses punctuation into single dashes", () => {
    expect(slugify("Steins;Gate 0 — Special!")).toBe("steins-gate-0-special");
  });

  it("returns an empty string when nothing usable is left", () => {
    expect(slugify("進撃の巨人")).toBe("");
  });
});

describe("seasonOf", () => {
  it("maps months to seasons", () => {
    expect(seasonOf("2021-01-10")).toEqual({ year: 2021, season: "WINTER" });
    expect(seasonOf("2021-04-05")).toEqual({ year: 2021, season: "SPRING" });
    expect(seasonOf("2021-08-01")).toEqual({ year: 2021, season: "SUMMER" });
    expect(seasonOf("2021-11-30")).toEqual({ year: 2021, season: "FALL" });
  });

  it("assigns late premieres to the next season, as seasonal charts do", () => {
    expect(seasonOf("2023-09-29")).toEqual({ year: 2023, season: "FALL" });
    expect(seasonOf("2023-06-25")).toEqual({ year: 2023, season: "SUMMER" });
    expect(seasonOf("2023-12-28")).toEqual({ year: 2024, season: "WINTER" });
    expect(seasonOf("2023-09-10")).toEqual({ year: 2023, season: "SUMMER" });
  });
});
