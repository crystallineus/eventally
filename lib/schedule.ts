import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { deleteOldDemos } from "@/lib/demo";
import { issueNextInvoice } from "@/lib/invoicing";
import { dueDateOf, planNextInvoice } from "@/lib/ledger";
import { formatUsd } from "@/lib/money";
import { formatPeriod } from "@/lib/period";
import type { User } from "@/lib/session";
import { todayInAppZone } from "@/lib/time";
import { payInvoiceWithVault } from "@/lib/vault";
import { runVia, viaMeta } from "@/lib/via";

// Set it once, then EvenTally handles the month: the landlord can have the next rent invoice sent a
// few days before it's due, and the tenant can have it paid with their saved PayPal on the due date.
// Both are switched on by the person themselves; the daily schedule (Vercel Cron, /api/cron/daily)
// only follows those settings. It's plain code, never the AI.

type Lease = typeof schema.leases.$inferSelect;

export const AUTO_INVOICE_DAYS = 5;
/** Autopay skips an invoice above this share of the rent (repairs charged on it) and asks instead. */
export const AUTOPAY_LIMIT = 1.5;
export const SCHEDULE_VIA = "Schedule";

export { dueDateOf };
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Landlord turns auto-send on (AUTO_INVOICE_DAYS before the due date) or off. */
export async function setAutoInvoice(user: User, leaseId: string, on: boolean) {
  const [lease] = await db().select().from(schema.leases).where(eq(schema.leases.id, leaseId));
  if (!lease || lease.landlordId !== user.id) throw new Error("Only the landlord can change how invoices are sent");
  if ((lease.autoInvoiceDays !== null) === on) return;
  await db().update(schema.leases).set({ autoInvoiceDays: on ? AUTO_INVOICE_DAYS : null }).where(eq(schema.leases.id, lease.id));
  await db().insert(schema.events).values({
    leaseId: lease.id,
    actor: "landlord",
    type: on ? "lease.auto_invoice_on" : "lease.auto_invoice_off",
    data: { ...viaMeta(), by: user.name, days: AUTO_INVOICE_DAYS },
  });
}

/** Tenant turns autopay on (needs a saved PayPal) or off. */
export async function setAutopay(user: User, leaseId: string, on: boolean) {
  const [lease] = await db().select().from(schema.leases).where(eq(schema.leases.id, leaseId));
  if (!lease || lease.tenantId !== user.id) throw new Error("Only the tenant can turn autopay on or off");
  if (on && !user.paypalVaultId) throw new Error("Save your PayPal first");
  if (lease.autopay === on) return;
  await db().update(schema.leases).set({ autopay: on }).where(eq(schema.leases.id, lease.id));
  await db().insert(schema.events).values({
    leaseId: lease.id,
    actor: "tenant",
    type: on ? "lease.autopay_on" : "lease.autopay_off",
    data: { ...viaMeta(), by: user.name, limitCents: Math.round(lease.rentCents * AUTOPAY_LIMIT) },
  });
}

export type ScheduleResult = { sent: string[]; paid: string[]; skipped: string[]; failed: string[]; demosDeleted: number };

/**
 * The daily run. `today` (YYYY-MM-DD, Pacific) and `leaseIds` let the demo's "fast-forward" button
 * run the same logic for one lease on its next due date.
 */
export async function runDailySchedule(options: { today?: string; leaseIds?: string[] } = {}): Promise<ScheduleResult> {
  const today = options.today ?? todayInAppZone();
  const result: ScheduleResult = { sent: [], paid: [], skipped: [], failed: [], demosDeleted: 0 };
  const scope = options.leaseIds ? inArray(schema.leases.id, options.leaseIds) : undefined;
  const leases = await db()
    .select()
    .from(schema.leases)
    .where(and(or(isNotNull(schema.leases.autoInvoiceDays), eq(schema.leases.autopay, true)), scope));

  for (const lease of leases) {
    const people = await db().select().from(schema.users).where(inArray(schema.users.id, [lease.landlordId, lease.tenantId ?? lease.landlordId]));
    const landlord = people.find((p) => p.id === lease.landlordId)!;
    const tenant = people.find((p) => p.id === lease.tenantId);
    // Auto-send first, so on a due date the invoice it sends can be autopaid in the same run.
    if (lease.autoInvoiceDays !== null) await autoSend(lease, landlord, today, result);
    if (lease.autopay && tenant) await autoPay(lease, tenant, today, result);
  }
  if (!options.leaseIds) result.demosDeleted = await deleteOldDemos(20);
  return result;
}

async function autoSend(lease: Lease, landlord: User, today: string, result: ScheduleResult) {
  const [entries, claims, open] = await Promise.all([
    db().select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.leaseId, lease.id)),
    db().select().from(schema.claims).where(and(eq(schema.claims.leaseId, lease.id), eq(schema.claims.status, "approved"))),
    db().select().from(schema.invoices).where(and(eq(schema.invoices.leaseId, lease.id), inArray(schema.invoices.status, ["draft", "sent"]))),
  ]);
  if (open.length) return; // one invoice at a time; the last one isn't paid yet
  const plan = planNextInvoice(lease, entries, claims);
  if (plan.afterLeaseEnd) return;
  if (daysBetween(today, dueDateOf(lease, plan.period)) > (lease.autoInvoiceDays ?? 0)) return;
  try {
    await runVia(SCHEDULE_VIA, () => issueNextInvoice(landlord, lease.id));
    result.sent.push(lease.id);
  } catch (err) {
    result.failed.push(lease.id);
    await logScheduleProblem(lease, "invoice.auto_send_failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

async function autoPay(lease: Lease, tenant: User, today: string, result: ScheduleResult) {
  const [invoice] = await db()
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.leaseId, lease.id), eq(schema.invoices.status, "sent")));
  if (!invoice || today < dueDateOf(lease, invoice.period)) return;

  const limit = Math.round(lease.rentCents * AUTOPAY_LIMIT);
  if (invoice.totalCents > limit) {
    // Ask once per invoice instead of charging an unusually large amount.
    if (!(await skippedFor(lease.id, invoice.id))) {
      await logScheduleProblem(lease, "invoice.autopay_skipped", {
        invoiceId: invoice.id,
        period: formatPeriod(invoice.period),
        totalCents: invoice.totalCents,
        limitCents: limit,
      });
    }
    result.skipped.push(lease.id);
    return;
  }
  try {
    await runVia(SCHEDULE_VIA, () => payInvoiceWithVault(tenant, lease, invoice.id));
    result.paid.push(lease.id);
  } catch (err) {
    result.failed.push(lease.id);
    await logScheduleProblem(lease, "invoice.autopay_failed", { invoiceId: invoice.id, period: formatPeriod(invoice.period), error: err instanceof Error ? err.message : String(err) });
  }
}

async function skippedFor(leaseId: string, invoiceId: string) {
  const rows = await db()
    .select({ data: schema.events.data })
    .from(schema.events)
    .where(and(eq(schema.events.leaseId, leaseId), eq(schema.events.type, "invoice.autopay_skipped")));
  return rows.some((r) => (r.data as { invoiceId?: string }).invoiceId === invoiceId);
}

async function logScheduleProblem(lease: Lease, type: string, data: Record<string, unknown>) {
  await db().insert(schema.events).values({ leaseId: lease.id, actor: "system", type, data: { via: SCHEDULE_VIA, ...data } });
}

/** The demo's next due date: where "fast-forward" jumps to. */
export async function nextDueDate(lease: Lease) {
  const [sent] = await db()
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.leaseId, lease.id), inArray(schema.invoices.status, ["draft", "sent"])));
  if (sent) return dueDateOf(lease, sent.period);
  const [entries, claims] = await Promise.all([
    db().select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.leaseId, lease.id)),
    db().select().from(schema.claims).where(and(eq(schema.claims.leaseId, lease.id), eq(schema.claims.status, "approved"))),
  ]);
  return dueDateOf(lease, planNextInvoice(lease, entries, claims).period);
}

export const describeLimit = (lease: Pick<Lease, "rentCents">) => formatUsd(Math.round(lease.rentCents * AUTOPAY_LIMIT));
