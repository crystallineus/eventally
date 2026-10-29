"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { issueNextInvoice, sendInvoice, syncInvoice } from "@/lib/invoicing";
import { requireUser } from "@/lib/session";
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
