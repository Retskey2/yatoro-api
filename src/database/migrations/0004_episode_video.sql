CREATE TYPE "public"."video_status" AS ENUM('NONE', 'UPLOADING', 'PROCESSING', 'READY', 'FAILED');--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "video_status" "video_status" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "video_source_key" text;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "video_hls_prefix" text;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "video_progress" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "video_duration_sec" real;--> statement-breakpoint
ALTER TABLE "episodes" ADD COLUMN "video_error" text;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_video_progress_range" CHECK ("episodes"."video_progress" between 0 and 100);