import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { settleFromPayPal, settleInvoice } from "@/lib/invoicing";
import { formatUsd } from "@/lib/money";
import { chargeVault, createVaultSetup, createVaultToken, deleteVaultToken, getInvoice, PayPalError, recordInvoicePayment } from "@/lib/paypal";
import { formatPeriod } from "@/lib/period";
import type { User } from "@/lib/session";
import { todayInAppZone } from "@/lib/time";
import { viaMeta } from "@/lib/via";

// A tenant saves their PayPal once (PayPal Vault); after that, paying a rent invoice is one press of
// Confirm in the chat. The money moves with a merchant-initiated PayPal order, then the payment is
// recorded on the PayPal invoice so both PayPal and the ledger show it paid.

type Lease = typeof schema.leases.$inferSelect;

/** Holds "<userId>:<setupToken>" between leaving for PayPal and coming back. */
export const VAULT_SETUP_COOKIE = "eventally_vault_setup";

async function tenantLeases(userId: string) {
  return db().select().from(schema.leases).where(eq(schema.leases.tenantId, userId));
}

/** Step 1: get PayPal's approval link. The caller keeps `setupToken` to check the return against. */
export async function startVaultSetup(user: User, origin: string) {
  if (!(await tenantLeases(user.id)).length) throw new Error("Only tenants save a PayPal for rent");
  return createVaultSetup(`${origin}/api/vault/return`, `${origin}/ledger?vault=cancelled`);
}

/** Step 2: PayPal sent the tenant back after they approved. */
export async function finishVaultSetup(user: User, setupToken: string) {
  const { vaultId, email } = await createVaultToken(setupToken);
  if (user.paypalVaultId && user.paypalVaultId !== vaultId) await deleteVaultToken(user.paypalVaultId);
  await db().update(schema.users).set({ paypalVaultId: vaultId, paypalVaultEmail: email }).where(eq(schema.users.id, user.id));
  await logForLeases(user.id, "vault.saved", { by: user.name, email });
}

export async function removeVault(user: User) {
  if (!user.paypalVaultId) return;
  await deleteVaultToken(user.paypalVaultId);
  await db().update(schema.users).set({ paypalVaultId: null, paypalVaultEmail: null }).where(eq(schema.users.id, user.id));
  await logForLeases(user.id, "vault.removed", { by: user.name });
}

async function logForLeases(userId: string, type: string, data: Record<string, unknown>) {
  const leases = await tenantLeases(userId);
  if (leases.length) await db().insert(schema.events).values(leases.map((l) => ({ leaseId: l.id, actor: "tenant" as const, type, data: { ...viaMeta(), ...data } })));
}

/** The rent invoice the tenant can pay right now, if any. */
export async function payableInvoice(lease: Lease, invoiceId?: string) {
  const conditions = [eq(schema.invoices.leaseId, lease.id), eq(schema.invoices.status, "sent")];
  if (invoiceId) conditions.push(eq(schema.invoices.id, invoiceId));
  const [invoice] = await db().select().from(schema.invoices).where(and(...conditions));
  return invoice?.paypalInvoiceId ? invoice : null;
}

/** Pay a sent rent invoice with the tenant's saved PayPal. Safe to repeat: it never charges twice. */
export async function payInvoiceWithVault(user: User, lease: Lease, invoiceId: string): Promise<{ paidCents: number; period: string }> {
  if (lease.tenantId !== user.id) throw new Error("Only the tenant can pay rent");
  if (!user.paypalVaultId) throw new Error("Save your PayPal first");
  const invoice = await payableInvoice(lease, invoiceId);
  if (!invoice) throw new Error("That invoice isn't waiting for payment");
  const period = formatPeriod(invoice.period);

  // Paid through the invoice link already (webhook not here yet)? Settle that instead of charging.
  const remote = await getInvoice(invoice.paypalInvoiceId!);
  if (remote.status === "PAID" || remote.status === "MARKED_AS_PAID") {
    await settleFromPayPal(remote, "sync", null);
    throw new Error(`The ${period} invoice is already paid`);
  }

  let charge;
  try {
    charge = await chargeVault({
      vaultId: user.paypalVaultId,
      amountCents: invoice.totalCents,
      description: `${lease.propertyName} rent, ${period}`,
      invoiceId: `eventally-${invoice.id}`,
      requestId: `eventally-vault-${invoice.id}`,
    });
  } catch (err) {
    if (err instanceof PayPalError && err.status === 422) throw new Error("PayPal declined the saved PayPal. Pay with the invoice link instead.");
    throw err;
  }
  if (charge.status !== "COMPLETED" || charge.captureStatus !== "COMPLETED" || !charge.captureId) {
    throw new Error(`PayPal hasn't completed the payment yet (${charge.captureStatus ?? charge.status})`);
  }

  const result = await settleInvoice(invoice.id, { paidCents: invoice.totalCents, paymentId: charge.captureId, paypalEventId: null, source: "vault" });
  if (result === "settled") {
    // Only the first settle records it on PayPal's invoice, so a repeat can't record it twice.
    await recordInvoicePayment(invoice.paypalInvoiceId!, {
      amountCents: invoice.totalCents,
      date: todayInAppZone(),
      note: `Paid ${formatUsd(invoice.totalCents)} with saved PayPal via EvenTally (capture ${charge.captureId})`,
    }).catch(async (err) => {
      await db().insert(schema.events).values({
        leaseId: lease.id,
        actor: "system",
        type: "invoice.record_failed",
        data: { error: err instanceof Error ? err.message : String(err), captureId: charge.captureId },
      });
    });
  }
  return { paidCents: invoice.totalCents, period };
}
