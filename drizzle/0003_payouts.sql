CREATE TYPE "public"."payout_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
ALTER TYPE "public"."claim_status" ADD VALUE 'paid_out';--> statement-breakpoint
ALTER TYPE "public"."ledger_kind" ADD VALUE 'payout';--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"lease_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "payout_status" DEFAULT 'pending' NOT NULL,
	"paypal_batch_id" text,
	"paypal_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_claim_id_unique" UNIQUE("claim_id"),
	CONSTRAINT "payouts_paypal_batch_id_unique" UNIQUE("paypal_batch_id")
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "sign_matches_kind";--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_lease_id_leases_id_fk" FOREIGN KEY ("lease_id") REFERENCES "public"."leases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "sign_matches_kind" CHECK (("ledger_entries"."kind"::text in ('rent', 'charge', 'payout') and "ledger_entries"."amount_cents" > 0) or ("ledger_entries"."kind"::text in ('credit', 'carry_over', 'payment') and "ledger_entries"."amount_cents" < 0));