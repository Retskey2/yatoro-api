CREATE TYPE "public"."age_rating" AS ENUM('G', 'PG', 'PG_13', 'R', 'R_PLUS');--> statement-breakpoint
CREATE TYPE "public"."anime_kind" AS ENUM('TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC');--> statement-breakpoint
CREATE TYPE "public"."season" AS ENUM('WINTER', 'SPRING', 'SUMMER', 'FALL');--> statement-breakpoint
CREATE TYPE "public"."genre_kind" AS ENUM('GENRE', 'THEME', 'DEMOGRAPHIC');--> statement-breakpoint
CREATE TABLE "anime_studios" (
	"anime_id" integer NOT NULL,
	"studio_id" integer NOT NULL,
	CONSTRAINT "anime_studios_anime_id_studio_id_pk" PRIMARY KEY("anime_id","studio_id")
);
--> statement-breakpoint
CREATE TABLE "studios" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "studios_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"shikimori_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studios_slug_unique" UNIQUE("slug"),
	CONSTRAINT "studios_shikimoriId_unique" UNIQUE("shikimori_id")
);
--> statement-breakpoint
ALTER TABLE "genres" ADD COLUMN "kind" "genre_kind" DEFAULT 'GENRE' NOT NULL;--> statement-breakpoint
ALTER TABLE "genres" ADD COLUMN "shikimori_id" integer;--> statement-breakpoint
-- Hand-edited: existing rows need a slug before the column can become NOT NULL
ALTER TABLE "anime" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "anime" SET "slug" = 'anime-' || "id" WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "anime" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "title_en" text;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "title_ja" text;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "title_romaji" text;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "synonyms" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "kind" "anime_kind" DEFAULT 'TV' NOT NULL;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "age_rating" "age_rating";--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "episodes_total" integer;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "episodes_aired" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "duration_min" integer;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "score" real;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "aired_on" date;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "released_on" date;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "season" "season";--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "popularity_rank" integer;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "shikimori_id" integer;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "mal_id" integer;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (
  setweight(to_tsvector('russian', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("title_en", '')), 'A') ||
  setweight(to_tsvector('simple', coalesce("title_romaji", '')), 'A') ||
  setweight(to_tsvector('simple', yatoro_array_to_text("synonyms")), 'B') ||
  setweight(to_tsvector('russian', coalesce("description", '')), 'D')) STORED;--> statement-breakpoint
ALTER TABLE "anime" ADD COLUMN "search_text" text GENERATED ALWAYS AS (lower(
  coalesce("title", '') || ' ' || coalesce("title_en", '') || ' ' ||
  coalesce("title_romaji", '') || ' ' || coalesce("title_ja", '') || ' ' ||
  yatoro_array_to_text("synonyms"))) STORED;--> statement-breakpoint
ALTER TABLE "anime_studios" ADD CONSTRAINT "anime_studios_anime_id_anime_id_fk" FOREIGN KEY ("anime_id") REFERENCES "public"."anime"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anime_studios" ADD CONSTRAINT "anime_studios_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "anime_studios_studio_id_index" ON "anime_studios" USING btree ("studio_id");--> statement-breakpoint
CREATE INDEX "anime_search_vector_idx" ON "anime" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "anime_search_text_trgm_idx" ON "anime" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "anime_popular_keyset_idx" ON "anime" USING btree (coalesce("popularity_rank", 2147483647),"id");--> statement-breakpoint
CREATE INDEX "anime_score_keyset_idx" ON "anime" USING btree (coalesce("score", -1),"id");--> statement-breakpoint
CREATE INDEX "anime_newest_keyset_idx" ON "anime" USING btree (coalesce("aired_on", '0001-01-01'::date),"id");--> statement-breakpoint
CREATE INDEX "anime_title_keyset_idx" ON "anime" USING btree ("title","id");--> statement-breakpoint
CREATE INDEX "anime_year_season_index" ON "anime" USING btree ("year","season");--> statement-breakpoint
ALTER TABLE "genres" ADD CONSTRAINT "genres_shikimoriId_unique" UNIQUE("shikimori_id");--> statement-breakpoint
ALTER TABLE "anime" ADD CONSTRAINT "anime_slug_unique" UNIQUE("slug");--> statement-breakpoint
ALTER TABLE "anime" ADD CONSTRAINT "anime_shikimoriId_unique" UNIQUE("shikimori_id");--> statement-breakpoint
ALTER TABLE "anime" ADD CONSTRAINT "anime_malId_unique" UNIQUE("mal_id");