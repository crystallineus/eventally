ALTER TABLE "leases" ADD COLUMN "auto_invoice_days" integer;--> statement-breakpoint
ALTER TABLE "leases" ADD COLUMN "autopay" boolean DEFAULT false NOT NULL;