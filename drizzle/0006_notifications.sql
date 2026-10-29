CREATE TYPE "public"."notify_level" AS ENUM('important', 'all', 'off');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify" "notify_level" DEFAULT 'important' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notifications_seen_at" timestamp with time zone;