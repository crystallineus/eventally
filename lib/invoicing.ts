import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { planNextInvoice } from "@/lib/ledger";
import { formatUsd, parseUsd, type Cents } from "@/lib/money";
import { createAndSendInvoice, getInvoice, PayPalError } from "@/lib/paypal";
import { formatPeriod, nextPeriod } from "@/lib/period";
import type { User } from "@/lib/session";

// Issuing next month's rent invoice and settling it when PayPal says it's paid.
// Money only ever moves tenant -> landlord, on the landlord's own PayPal invoice.

type Invoice = typeof schema.invoices.$inferSelect;

/**
 * The landlord issues the next rent invoice: ledger entries for rent, approved claims and carried
 * credit are written together with the invoice row, then the invoice is sent through PayPal.
 * A $0 invoice (credit covered the rent) is settled without PayPal.
 */
export async function issueNextInvoice(user: User, leaseId: string): Promise<Invoice> {
  const invoice = await db().transaction(async (tx) => {
    // Lock the lease so two clicks can't issue the same period twice.
    const [lease] = await tx.select().from(schema.leases).where(eq(schema.leases.id, leaseId)).for("update");
    if (!lease || lease.landlordId !== user.id) throw new Error("Only the landlord can send the rent invoice");
    if (!lease.tenantId) throw new Error("Invite a tenant before sending an invoice");

    const [entries, claims] = await Promise.all([
      tx.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.leaseId, lease.id)),
      tx.select().from(schema.claims).where(and(eq(schema.claims.leaseId, lease.id), eq(schema.claims.status, "approved"))),
    ]);
    // One invoice at a time: the next month can't be billed while the last one is unpaid.
    const [outstanding] = await tx
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.leaseId, lease.id), inArray(schema.invoices.status, ["draft", "sent"])));
    if (outstanding) throw new Error(`The ${formatPeriod(outstanding.period)} invoice hasn't been paid yet`);

    const plan = planNextInvoice(lease, entries, claims);
    const [existing] = await tx
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.leaseId, lease.id), eq(schema.invoices.period, plan.period)));
    if (existing) throw new Error(`The ${plan.label} invoice already exists`);

    const [row] = await tx
      .insert(schema.invoices)
      .values({ leaseId: lease.id, period: plan.period, totalCents: plan.invoice.totalCents, status: "draft" })
      .returning();

    for (const line of plan.invoice.lines) {
      if (line.entryId) {
        // Credit carried over from an earlier period already has a ledger entry; attach it.
        await tx.update(schema.ledgerEntries).set({ invoiceId: row.id }).where(eq(schema.ledgerEntries.id, line.entryId));
        continue;
      }
      const kind = line.claimId ? (line.amountCents < 0 ? "credit" : "charge") : line.amountCents < 0 ? "credit" : line.name.startsWith("Rent") ? "rent" : "charge";
      await tx.insert(schema.ledgerEntries).values({
        leaseId: lease.id,
        period: plan.period,
        kind,
        amountCents: line.amountCents,
        description: line.name,
        claimId: line.claimId,
        invoiceId: row.id,
      });
    }
    if (plan.invoice.carryOverCents > 0) {
      // The positive "carried over" line above balances this period; the credit lands next period.
      await tx.insert(schema.ledgerEntries).values({
        leaseId: lease.id,
        period: nextPeriod(plan.period),
        kind: "carry_over",
        amountCents: -plan.invoice.carryOverCents,
        description: `Credit carried over from ${plan.label}`,
      });
    }

    const claimIds = plan.invoice.lines.map((l) => l.claimId).filter((id): id is string => !!id);
    if (claimIds.length) {
      await tx.update(schema.claims).set({ status: "invoiced", updatedAt: new Date() }).where(inArray(schema.claims.id, claimIds));
    }
    await tx.insert(schema.events).values({
      leaseId: lease.id,
      actor: "landlord",
      type: "invoice.created",
      data: { by: user.name, period: plan.label, totalCents: plan.invoice.totalCents, claims: claimIds.length },
    });
    return row;
  });

  if (invoice.totalCents === 0) {
    await settleInvoice(invoice.id, { paidCents: 0, paymentId: null, paypalEventId: null, source: "zero_total" });
    return invoice;
  }
  return sendInvoice(invoice.id);
}

/** Send (or re-send after a failure) a draft invoice through PayPal. Safe to retry. */
export async function sendInvoice(invoiceId: string): Promise<Invoice> {
  const [invoice] = await db().select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status !== "draft") return invoice;

  const [lease] = await db().select().from(schema.leases).where(eq(schema.leases.id, invoice.leaseId));
  const people = await db().select().from(schema.users).where(inArray(schema.users.id, [lease.landlordId, lease.tenantId!]));
  const landlord = people.find((p) => p.id === lease.landlordId)!;
  const tenant = people.find((p) => p.id === lease.tenantId)!;
  const lines = await db()
    .select()
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.invoiceId, invoice.id))
    .orderBy(asc(schema.ledgerEntries.createdAt));
  const claimCount = lines.filter((l) => l.claimId).length;

  try {
    const sent = await createAndSendInvoice({
      requestId: invoice.id,
      invoiceNumber: `ET-${invoice.period}-${invoice.id.slice(0, 8).toUpperCase()}`,
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: `${invoice.period}-${String(lease.dueDay).padStart(2, "0")}`,
      note: claimCount
        ? `${lease.propertyName} rent with ${claimCount} approved repair adjustment${claimCount > 1 ? "s" : ""}. Details are in your EvenTally ledger.`
        : `${lease.propertyName} rent. Details are in your EvenTally ledger.`,
      invoicerEmail: landlord.paypalEmail ?? landlord.email,
      recipientEmail: tenant.paypalEmail ?? tenant.email,
      lines: lines.map((l) => ({ name: l.description, amountCents: l.amountCents })),
    });
    const [updated] = await db()
      .update(schema.invoices)
      .set({ paypalInvoiceId: sent.id, status: "sent", payerUrl: sent.detail.metadata?.recipient_view_url ?? null })
      .where(eq(schema.invoices.id, invoice.id))
      .returning();
    await db().insert(schema.events).values({
      leaseId: lease.id,
      actor: "system",
      type: "invoice.sent",
      data: { paypalInvoiceId: sent.id, totalCents: invoice.totalCents, to: tenant.name },
    });
    return updated;
  } catch (err) {
    await db().insert(schema.events).values({
      leaseId: lease.id,
      actor: "system",
      type: "invoice.send_failed",
      data: { error: err instanceof Error ? err.message : String(err), detail: err instanceof PayPalError ? err.body : null },
    });
    throw new Error("PayPal didn't accept the invoice. It's saved as a draft; try sending it again.");
  }
}

type Payment = { paidCents: Cents; paymentId: string | null; paypalEventId: string | null; source: "webhook" | "sync" | "zero_total" };

/**
 * Mark an invoice paid: record the payment in the ledger and settle its claims. Idempotent: the
 * invoice row is locked and an already-paid invoice is left alone, so webhook redeliveries and
 * manual syncs can't double-count. A repeated PayPal event id is also rejected by its unique index.
 */
export async function settleInvoice(invoiceId: string, payment: Payment): Promise<"settled" | "already_paid"> {
  return db().transaction(async (tx) => {
    const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).for("update");
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "paid") return "already_paid";

    const now = new Date();
    await tx.update(schema.invoices).set({ status: "paid", paidAt: now }).where(eq(schema.invoices.id, invoice.id));
    if (payment.paidCents > 0) {
      await tx.insert(schema.ledgerEntries).values({
        leaseId: invoice.leaseId,
        period: invoice.period,
        kind: "payment",
        amountCents: -payment.paidCents,
        description: `PayPal payment${payment.paymentId ? ` ${payment.paymentId}` : ""}`,
        invoiceId: invoice.id,
      });
    }
    const claimRows = await tx
      .select({ claimId: schema.ledgerEntries.claimId })
      .from(schema.ledgerEntries)
      .where(and(eq(schema.ledgerEntries.invoiceId, invoice.id), isNotNull(schema.ledgerEntries.claimId)));
    const claimIds = claimRows.map((r) => r.claimId!);
    if (claimIds.length) {
      await tx.update(schema.claims).set({ status: "settled", updatedAt: now }).where(inArray(schema.claims.id, claimIds));
    }
    await tx.insert(schema.events).values({
      leaseId: invoice.leaseId,
      actor: payment.source === "webhook" ? "paypal" : "system",
      type: "invoice.paid",
      paypalEventId: payment.paypalEventId,
      data: {
        totalCents: invoice.totalCents,
        paidCents: payment.paidCents,
        paymentId: payment.paymentId,
        source: payment.source,
        summary:
          payment.source === "zero_total"
            ? "Credits covered this month's rent, so there was nothing to pay."
            : `Paid ${formatUsd(payment.paidCents)} through PayPal.`,
      },
    });
    return "settled";
  });
}

/** Apply a PayPal invoice object that reports PAID (from a webhook or a manual check). */
export async function settleFromPayPal(
  paypalInvoice: { id: string; status: string; payments?: { paid_amount?: { value: string }; transactions?: { payment_id: string }[] } },
  source: "webhook" | "sync",
  paypalEventId: string | null,
) {
  if (paypalInvoice.status !== "PAID") return "not_paid" as const;
  const [invoice] = await db().select().from(schema.invoices).where(eq(schema.invoices.paypalInvoiceId, paypalInvoice.id));
  if (!invoice) return "unknown_invoice" as const;
  return settleInvoice(invoice.id, {
    paidCents: paypalInvoice.payments?.paid_amount ? parseUsd(paypalInvoice.payments.paid_amount.value) : invoice.totalCents,
    paymentId: paypalInvoice.payments?.transactions?.at(-1)?.payment_id ?? null,
    paypalEventId,
    source,
  });
}

/** Fallback when a webhook is slow or missing: ask PayPal directly. */
export async function syncInvoice(invoiceId: string) {
  const [invoice] = await db().select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!invoice?.paypalInvoiceId || invoice.status !== "sent") return "nothing_to_sync" as const;
  return settleFromPayPal(await getInvoice(invoice.paypalInvoiceId), "sync", null);
}
