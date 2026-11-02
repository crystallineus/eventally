ALTER TABLE "claims" ADD COLUMN "shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
-- Claims made before drafts existed were visible to both sides from the start.
UPDATE "claims" SET "shared_at" = "created_at";
