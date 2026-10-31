"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { issueNextInvoice, sendInvoice, syncInvoice } from "@/lib/invoicing";
import { requireUser } from "@/lib/session";
import { formatDate } from "@/lib/period";
import { nextDueDate, runDailySchedule, setAutoInvoice, setAutopay } from "@/lib/schedule";
import { payInvoiceWithVault } from "@/lib/vault";

export type InvoiceFormState = { error: string | null; note?: string };

export async function sendNextInvoice(_prev: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  const user = await requireUser();
  try {
    await issueNextInvoice(user, String(formData.get("leaseId")));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not send the invoice" };
  }
  revalidatePath("/ledger");
  return { error: null };
}

/** Landlord-only: retry a draft that PayPal rejected, or ask PayPal whether a sent invoice was paid. */
export async function refreshInvoice(_prev: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  const user = await requireUser();
  const [row] = await db()
    .select({ invoice: schema.invoices, landlordId: schema.leases.landlordId })
    .from(schema.invoices)
    .innerJoin(schema.leases, eq(schema.invoices.leaseId, schema.leases.id))
    .where(eq(schema.invoices.id, String(formData.get("invoiceId"))));
  if (!row || row.landlordId !== user.id) return { error: "Invoice not found" };
  try {
    if (row.invoice.status === "draft") {
      await sendInvoice(row.invoice.id);
    } else {
      const result = await syncInvoice(row.invoice.id);
      if (result === "not_paid") return { error: null, note: "PayPal shows it as not paid yet." };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "PayPal request failed" };
  }
  revalidatePath("/ledger");
  return { error: null };
}

/** Tenant: pay a sent invoice with the PayPal they saved for rent. */
export async function payWithSaved(_prev: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  const user = await requireUser();
  const [lease] = await db().select().from(schema.leases).where(eq(schema.leases.id, String(formData.get("leaseId"))));
  if (!lease) return { error: "Lease not found" };
  try {
    await payInvoiceWithVault(user, lease, String(formData.get("invoiceId")));
  } catch (err) {
    return { error: err instanceof Error ? err.message : "PayPal request failed" };
  }
  revalidatePath("/ledger");
  return { error: null };
}

/** Either side's ledger asks PayPal whether a sent invoice was paid (backup for the webhook). */
export async function checkPayment(invoiceId: string): Promise<string> {
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return "not_found";
  const [row] = await db()
    .select({ invoice: schema.invoices, landlordId: schema.leases.landlordId, tenantId: schema.leases.tenantId })
    .from(schema.invoices)
    .innerJoin(schema.leases, eq(schema.invoices.leaseId, schema.leases.id))
    .where(eq(schema.invoices.id, invoiceId));
  if (!row || (row.landlordId !== user.id && row.tenantId !== user.id)) return "not_found";
  try {
    return await syncInvoice(invoiceId);
  } catch {
    return "error";
  }
}

/** Landlord: send the next invoice automatically a few days before it's due, or stop. */
export async function toggleAutoInvoice(formData: FormData) {
  const user = await requireUser();
  await setAutoInvoice(user, String(formData.get("leaseId")), formData.get("on") === "1");
  revalidatePath("/ledger");
}

/** Tenant: pay sent invoices with the saved PayPal on the due date, or stop. */
export async function toggleAutopay(formData: FormData) {
  const user = await requireUser();
  await setAutopay(user, String(formData.get("leaseId")), formData.get("on") === "1");
  revalidatePath("/ledger");
}

/**
 * Demo only: jump to the lease's next due date and run the daily schedule for it now, so visitors
 * see auto-send and autopay without waiting for the real one.
 */
export async function fastForward(_prev: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  const user = await requireUser();
  const [lease] = await db().select().from(schema.leases).where(eq(schema.leases.id, String(formData.get("leaseId"))));
  if (!user.demoId || !lease || (lease.landlordId !== user.id && lease.tenantId !== user.id)) return { error: "Not available" };
  const today = await nextDueDate(lease);
  const result = await runDailySchedule({ today, leaseIds: [lease.id] });
  revalidatePath("/ledger");
  const done = [result.sent.length && "the invoice was sent automatically", result.paid.length && "autopay paid it", result.skipped.length && "autopay waited because the invoice is over the limit"].filter(Boolean);
  if (result.failed.length) return { error: "Something didn't go through; see the activity log." };
  return { error: null, note: done.length ? `On ${formatDate(today)}: ${done.join(", then ")}.` : `Nothing to do on ${formatDate(today)}. Turn on auto-send or autopay first.` };
}
