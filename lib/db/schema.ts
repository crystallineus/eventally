import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { NOTIFY_LEVELS } from "../notifications-shared";

// Files live in Postgres for now; lib/storage.ts is the only code that should touch this column.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/**
 * One visitor's private copy of the demo (Tom, Maya, their lease and history), so people trying
 * the app at the same time don't see or change each other's data. Old ones are deleted.
 */
export const demos = pgTable("demos", {
  id: id(),
  createdAt: createdAt(),
});

/** Sample photos shared by every demo's starting claims, stored once instead of per demo. */
export const demoPhotos = pgTable("demo_photos", {
  name: text("name").primaryKey(),
  mimeType: text("mime_type").notNull(),
  data: bytea("data").notNull(),
  sha256: text("sha256").notNull(),
});

/** What shows up in the bell (and, later, email): only things that need you, every update, or nothing. */
export const notifyLevel = pgEnum("notify_level", NOTIFY_LEVELS);

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    /** The demo this person belongs to; null only for rows made before demos existed. */
    demoId: uuid("demo_id").references(() => demos.id),
    /** Unique within a demo: every demo has its own tom@eventally.demo. */
    email: text("email").notNull(),
    /** Landlord's business name as shown on PayPal invoices, e.g. "SJ Rentals". */
    businessName: text("business_name"),
    /** Where invoices are sent (tenant) or the PayPal merchant account (landlord). */
    paypalEmail: text("paypal_email"),
    /** Tenant's PayPal saved with PayPal Vault, so Aunt Tally can pay rent when they confirm. */
    paypalVaultId: text("paypal_vault_id"),
    paypalVaultEmail: text("paypal_vault_email"),
    notify: notifyLevel("notify").notNull().default("important"),
    /** Bell items up to here have been seen. */
    notificationsSeenAt: timestamp("notifications_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_demo_email_idx").on(t.demoId, t.email), index("users_demo_idx").on(t.demoId)],
);

export const leases = pgTable(
  "leases",
  {
    id: id(),
    propertyName: text("property_name").notNull(),
    address: text("address").notNull(),
    landlordId: uuid("landlord_id").notNull().references(() => users.id),
    tenantId: uuid("tenant_id").references(() => users.id), // null until the invite is accepted
    rentCents: integer("rent_cents").notNull(),
    depositCents: integer("deposit_cents").notNull().default(0),
    /** Day of month rent is due; capped at 28 so every month has it. */
    dueDay: integer("due_day").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    /** Repair clause pasted from the lease; the agent cites it when proposing a split. */
    repairClause: text("repair_clause").notNull(),
    /** Landlord's choice: the daily schedule sends the next invoice this many days before it's due. Null: off. */
    autoInvoiceDays: integer("auto_invoice_days"),
    /** Tenant's choice: the daily schedule pays a sent invoice with their saved PayPal on the due date. */
    autopay: boolean("autopay").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    check("rent_positive", sql`${t.rentCents} > 0`),
    check("due_day_range", sql`${t.dueDay} between 1 and 28`),
  ],
);

export const claimStatus = pgEnum("claim_status", [
  "reviewing", // agent is running checks
  "needs_evidence", // agent asked one side for more
  "awaiting_approval", // split proposed, waiting for both sides
  "approved", // both agreed; will be posted to the next rent invoice
  "invoiced", // included in a sent PayPal invoice
  "settled", // that invoice was paid
  "withdrawn",
  "paid_out", // landlord paid the tenant back directly via PayPal Payouts instead of crediting rent
]);

export const claims = pgTable(
  "claims",
  {
    id: id(),
    leaseId: uuid("lease_id").notNull().references(() => leases.id),
    submittedBy: uuid("submitted_by").notNull().references(() => users.id),
    title: text("title").notNull(),
    description: text("description").notNull(),
    /** Null when a claim came from the chat without a date; the review fills it from the receipt. */
    issueReportedAt: timestamp("issue_reported_at", { withTimezone: true }),
    status: claimStatus("status").notNull().default("reviewing"),
    /** Receipt total as confirmed by the submitter (may differ from what the agent extracted). Null until
     *  known: a claim from the chat can leave it to the review, which fills it from the receipt. */
    amountCents: integer("amount_cents"),
    landlordShareCents: integer("landlord_share_cents"),
    tenantShareCents: integer("tenant_share_cents"),
    splitRationale: text("split_rationale"),
    /** The tenant asked to be paid back right away via PayPal rather than credited on rent. A request; the landlord decides. */
    tenantWantsPayout: boolean("tenant_wants_payout").notNull().default(false),
    /** Set while an agent review runs, so two reviews of the same claim can't overlap. */
    reviewStartedAt: timestamp("review_started_at", { withTimezone: true }),
    landlordApprovedAt: timestamp("landlord_approved_at", { withTimezone: true }),
    tenantApprovedAt: timestamp("tenant_approved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("claims_lease_idx").on(t.leaseId),
    check(
      "split_adds_up",
      sql`${t.landlordShareCents} is null or ${t.landlordShareCents} + ${t.tenantShareCents} = ${t.amountCents}`,
    ),
  ],
);

export const evidenceKind = pgEnum("evidence_kind", ["before", "after", "receipt"]);

export const evidence = pgTable(
  "evidence",
  {
    id: id(),
    claimId: uuid("claim_id").notNull().references(() => claims.id),
    kind: evidenceKind("kind").notNull(),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    mimeType: text("mime_type").notNull(),
    /** The file itself, or null when it's a shared sample photo (`demoPhoto`). Read via lib/storage.ts. */
    data: bytea("data"),
    demoPhoto: text("demo_photo").references(() => demoPhotos.name),
    sha256: text("sha256").notNull(),
    /** Receipt fields read by the agent (validated with zod before saving). */
    extracted: jsonb("extracted"),
    createdAt: createdAt(),
  },
  (t) => [
    index("evidence_claim_idx").on(t.claimId),
    index("evidence_sha256_idx").on(t.sha256),
    check("evidence_has_file", sql`${t.data} is not null or ${t.demoPhoto} is not null`),
  ],
);

export const ledgerKind = pgEnum("ledger_kind", ["rent", "charge", "credit", "carry_over", "payment", "payout"]);

/**
 * Signed amounts from the tenant's point of view: positive = tenant owes more (rent, charge),
 * negative = tenant owes less (credit, carry_over, payment). A period's balance is the sum.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    leaseId: uuid("lease_id").notNull().references(() => leases.id),
    /** Rent period as "YYYY-MM". */
    period: text("period").notNull(),
    kind: ledgerKind("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    description: text("description").notNull(),
    claimId: uuid("claim_id").references(() => claims.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_lease_period_idx").on(t.leaseId, t.period),
    check("period_format", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      "sign_matches_kind",
      // A payout is money the landlord sent the tenant, so it cancels a credit: positive, like a charge.
      // Compared as text so this constraint can ship in the same migration that adds the enum value.
      sql`(${t.kind}::text in ('rent', 'charge', 'payout') and ${t.amountCents} > 0) or (${t.kind}::text in ('credit', 'carry_over', 'payment') and ${t.amountCents} < 0)`,
    ),
  ],
);

export const invoiceStatus = pgEnum("invoice_status", ["draft", "sent", "paid", "cancelled"]);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    leaseId: uuid("lease_id").notNull().references(() => leases.id),
    period: text("period").notNull(),
    paypalInvoiceId: text("paypal_invoice_id").unique(),
    status: invoiceStatus("status").notNull().default("draft"),
    totalCents: integer("total_cents").notNull(),
    payerUrl: text("payer_url"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invoices_lease_period_idx").on(t.leaseId, t.period)],
);

export const eventActor = pgEnum("event_actor", ["agent", "landlord", "tenant", "paypal", "system"]);

/** Append-only audit trail: agent tool calls and reasoning, approvals, PayPal webhooks. Never update or delete. */
export const events = pgTable(
  "events",
  {
    id: id(),
    leaseId: uuid("lease_id").notNull().references(() => leases.id),
    claimId: uuid("claim_id").references(() => claims.id),
    actor: eventActor("actor").notNull(),
    type: text("type").notNull(),
    data: jsonb("data").notNull().default({}),
    /** PayPal webhook event id; unique so a redelivered webhook can't be applied twice. */
    paypalEventId: text("paypal_event_id").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("events_lease_idx").on(t.leaseId, t.createdAt), index("events_claim_idx").on(t.claimId)],
);

export const payoutStatus = pgEnum("payout_status", ["pending", "succeeded", "failed"]);

/** A landlord paying a tenant back right away through PayPal Payouts, one per claim. */
export const payouts = pgTable("payouts", {
  id: id(),
  claimId: uuid("claim_id").notNull().unique().references(() => claims.id),
  leaseId: uuid("lease_id").notNull().references(() => leases.id),
  amountCents: integer("amount_cents").notNull(),
  status: payoutStatus("status").notNull().default("pending"),
  /** PayPal's payout_batch_id; our sender_batch_id is derived from the claim id. */
  paypalBatchId: text("paypal_batch_id").unique(),
  /** Latest PayPal item status, e.g. PENDING, SUCCESS, UNCLAIMED, FAILED. */
  paypalStatus: text("paypal_status"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
