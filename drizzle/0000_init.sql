CREATE TYPE "public"."claim_status" AS ENUM('reviewing', 'needs_evidence', 'awaiting_approval', 'approved', 'invoiced', 'settled', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."event_actor" AS ENUM('agent', 'landlord', 'tenant', 'paypal', 'system');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('before', 'after', 'receipt');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'sent', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('rent', 'charge', 'credit', 'carry_over', 'payment');--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"issue_reported_at" timestamp with time zone NOT NULL,
	"status" "claim_status" DEFAULT 'reviewing' NOT NULL,
	"amount_cents" integer,
	"landlord_share_cents" integer,
	"tenant_share_cents" integer,
	"split_rationale" text,
	"landlord_approved_at" timestamp with time zone,
	"tenant_approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "split_adds_up" CHECK ("claims"."landlord_share_cents" is null or "claims"."landlord_share_cents" + "claims"."tenant_share_cents" = "claims"."amount_cents")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid NOT NULL,
	"claim_id" uuid,
	"actor" "event_actor" NOT NULL,
	"type" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paypal_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_paypal_event_id_unique" UNIQUE("paypal_event_id")
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"kind" "evidence_kind" NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"sha256" text NOT NULL,
	"extracted" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid NOT NULL,
	"period" text NOT NULL,
	"paypal_invoice_id" text,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"total_cents" integer NOT NULL,
	"payer_url" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_paypal_invoice_id_unique" UNIQUE("paypal_invoice_id")
);
--> statement-breakpoint
CREATE TABLE "leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property_name" text NOT NULL,
	"address" text NOT NULL,
	"landlord_id" uuid NOT NULL,
	"tenant_id" uuid,
	"rent_cents" integer NOT NULL,
	"deposit_cents" integer DEFAULT 0 NOT NULL,
	"due_day" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"repair_clause" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rent_positive" CHECK ("leases"."rent_cents" > 0),
	CONSTRAINT "due_day_range" CHECK ("leases"."due_day" between 1 and 28)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lease_id" uuid NOT NULL,
	"period" text NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	"claim_id" uuid,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_format" CHECK ("ledger_entries"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "sign_matches_kind" CHECK (("ledger_entries"."kind" in ('rent', 'charge') and "ledger_entries"."amount_cents" > 0) or ("ledger_entries"."kind" in ('credit', 'carry_over', 'payment') and "ledger_entries"."amount_cents" < 0))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"paypal_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_landlord_id_users_id_fk" FOREIGN KEY ("landlord_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leases" ADD CONSTRAINT "leases_tenant_id_users_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claims_lease_idx" ON "claims" USING btree ("lease_id");--> statement-breakpoint
CREATE INDEX "events_lease_idx" ON "events" USING btree ("lease_id","created_at");--> statement-breakpoint
CREATE INDEX "events_claim_idx" ON "events" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "evidence_claim_idx" ON "evidence" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "evidence_sha256_idx" ON "evidence" USING btree ("sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_lease_period_idx" ON "invoices" USING btree ("lease_id","period");--> statement-breakpoint
CREATE INDEX "ledger_lease_period_idx" ON "ledger_entries" USING btree ("lease_id","period");