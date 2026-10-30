CREATE TABLE "demo_photos" (
	"name" text PRIMARY KEY NOT NULL,
	"mime_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"sha256" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
ALTER TABLE "evidence" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "evidence" ADD COLUMN "demo_photo" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "demo_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_demo_photo_demo_photos_name_fk" FOREIGN KEY ("demo_photo") REFERENCES "public"."demo_photos"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_demo_id_demos_id_fk" FOREIGN KEY ("demo_id") REFERENCES "public"."demos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_demo_email_idx" ON "users" USING btree ("demo_id","email");--> statement-breakpoint
CREATE INDEX "users_demo_idx" ON "users" USING btree ("demo_id");--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_has_file" CHECK ("evidence"."data" is not null or "evidence"."demo_photo" is not null);