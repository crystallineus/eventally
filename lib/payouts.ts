import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatUsd } from "@/lib/money";
import { createPayout, getPayout, PayPalError } from "@/lib/paypal";
import type { User } from "@/lib/session";
import { todayInAppZone } from "@/lib/time";

// Paying a tenant back right away through PayPal Payouts, instead of crediting next month's rent.
// Only for an approved claim the tenant paid for, where the landlord owes a share.

type Payout = typeof schema.payouts.$inferSelect;

// PayPal payout item statuses, grouped by what they mean for the claim.
const SUCCEEDED = new Set(["SUCCESS"]);
const FAILED = new Set(["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED", "DENIED", "CANCELED"]);

export async function payClaimNow(user: User, claimId: string): Promise<Payout> {
  const payout = await db().transaction(async (tx) => {
    const [row] = await tx
      .select({ claim: schema.claims, lease: schema.leases })
      .from(schema.claims)
      .innerJoin(schema.leases, eq(schema.claims.leaseId, schema.leases.id))
      .where(eq(schema.claims.id, claimId))
      .for("update", { of: schema.claims });
    if (!row || row.lease.landlordId !== user.id) throw new Error("Only the landlord can pay a claim back");
    const { claim, lease } = row;
    if (claim.status !== "approved") throw new Error("Only an approved claim that isn't on an invoice yet can be paid back now");
    if (claim.submittedBy === lease.landlordId || !claim.landlordShareCents) throw new Error("There's nothing to pay the tenant back on this claim");

    const [created] = await tx
      .insert(schema.payouts)
      .values({ claimId: claim.id, leaseId: lease.id, amountCents: claim.landlordShareCents })
      .returning();
    // Taking the claim out of "approved" keeps it off the next rent invoice.
    await tx.update(schema.claims).set({ status: "paid_out", updatedAt: new Date() }).where(eq(schema.claims.id, claim.id));
    await tx.insert(schema.events).values({
      leaseId: lease.id,
      claimId: claim.id,
      actor: "landlord",
      type: "payout.started",
      data: { by: user.name, amountCents: created.amountCents },
    });
    return created;
  });

  const [claim] = await db().select().from(schema.claims).where(eq(schema.claims.id, claimId));
  const [lease] = await db().select().from(schema.leases).where(eq(schema.leases.id, claim.leaseId));
  const [tenant] = await db().select().from(schema.users).where(eq(schema.users.id, lease.tenantId!));
  try {
    const batch = await createPayout({
      senderBatchId: `et-claim-${claim.id}`,
      receiverEmail: tenant.paypalEmail ?? tenant.email,
      amountCents: payout.amountCents,
      subject: `${lease.propertyName}: repair reimbursement`,
      note: `Reimbursement for "${claim.title}" (${formatUsd(payout.amountCents)}), approved in EvenTally.`,
    });
    const item = batch.items?.[0]?.transaction_status ?? batch.batch_header.batch_status;
    await db()
      .update(schema.payouts)
      .set({ paypalBatchId: batch.batch_header.payout_batch_id, paypalStatus: item, updatedAt: new Date() })
      .where(eq(schema.payouts.id, payout.id));
    return applyPayoutStatus(payout.id, item);
  } catch (err) {
    // PayPal refused the payout: put the claim back so it's credited on the next invoice instead.
    await failPayout(payout.id, err instanceof PayPalError ? String((err.body as { name?: string })?.name ?? err.message) : String(err));
    throw new Error("PayPal didn't send the payout. The claim is back to being credited on the next rent invoice.");
  }
}

/** Ask PayPal for the latest status (used by the webhook and while the page waits). */
export async function syncPayout(payoutId: string): Promise<Payout> {
  const [payout] = await db().select().from(schema.payouts).where(eq(schema.payouts.id, payoutId));
  if (!payout?.paypalBatchId || payout.status !== "pending") return payout;
  const batch = await getPayout(payout.paypalBatchId);
  const item = batch.items?.[0]?.transaction_status ?? batch.batch_header.batch_status;
  return applyPayoutStatus(payout.id, item);
}

export async function syncPayoutByBatch(paypalBatchId: string) {
  const [payout] = await db().select().from(schema.payouts).where(eq(schema.payouts.paypalBatchId, paypalBatchId));
  return payout ? syncPayout(payout.id) : null;
}

/**
 * Record a PayPal status. On success the ledger gets the credit and the payout as a matching pair,
 * so the payment is visible but doesn't change what the tenant owes. Idempotent: only a pending
 * payout (locked) moves.
 */
async function applyPayoutStatus(payoutId: string, paypalStatus: string): Promise<Payout> {
  if (FAILED.has(paypalStatus)) return failPayout(payoutId, paypalStatus);
  return db().transaction(async (tx) => {
    const [payout] = await tx.select().from(schema.payouts).where(eq(schema.payouts.id, payoutId)).for("update");
    if (payout.status !== "pending") return payout;
    if (!SUCCEEDED.has(paypalStatus)) {
      const [updated] = await tx.update(schema.payouts).set({ paypalStatus, updatedAt: new Date() }).where(eq(schema.payouts.id, payoutId)).returning();
      return updated;
    }

    const [claim] = await tx.select().from(schema.claims).where(eq(schema.claims.id, payout.claimId));
    const [tenant] = await tx
      .select({ name: schema.users.name })
      .from(schema.users)
      .innerJoin(schema.leases, eq(schema.leases.tenantId, schema.users.id))
      .where(eq(schema.leases.id, payout.leaseId));
    const period = todayInAppZone().slice(0, 7);
    await tx.insert(schema.ledgerEntries).values([
      { leaseId: payout.leaseId, period, kind: "credit", amountCents: -payout.amountCents, description: `Credit: ${claim.title}`, claimId: claim.id },
      { leaseId: payout.leaseId, period, kind: "payout", amountCents: payout.amountCents, description: `Paid back to ${tenant.name} via PayPal`, claimId: claim.id },
    ]);
    const [updated] = await tx
      .update(schema.payouts)
      .set({ status: "succeeded", paypalStatus, updatedAt: new Date() })
      .where(eq(schema.payouts.id, payoutId))
      .returning();
    await tx.insert(schema.events).values({
      leaseId: payout.leaseId,
      claimId: payout.claimId,
      actor: "paypal",
      type: "payout.succeeded",
      data: { amountCents: payout.amountCents, to: tenant.name },
    });
    return updated;
  });
}

async function failPayout(payoutId: string, reason: string): Promise<Payout> {
  return db().transaction(async (tx) => {
    const [payout] = await tx.select().from(schema.payouts).where(eq(schema.payouts.id, payoutId)).for("update");
    if (payout.status !== "pending") return payout;
    const [updated] = await tx
      .update(schema.payouts)
      .set({ status: "failed", paypalStatus: reason, updatedAt: new Date() })
      .where(eq(schema.payouts.id, payoutId))
      .returning();
    await tx
      .update(schema.claims)
      .set({ status: "approved", updatedAt: new Date() })
      .where(and(eq(schema.claims.id, payout.claimId), eq(schema.claims.status, "paid_out")));
    await tx.insert(schema.events).values({
      leaseId: payout.leaseId,
      claimId: payout.claimId,
      actor: "paypal",
      type: "payout.failed",
      data: { amountCents: payout.amountCents, reason },
    });
    return updated;
  });
}
