import { asc, desc, eq, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";
import { buildRentInvoice, sum, type Adjustment, type Cents, type RentInvoice } from "@/lib/money";
import { formatPeriod, nextPeriod, periodOf } from "@/lib/period";

type Lease = typeof schema.leases.$inferSelect;
type Claim = typeof schema.claims.$inferSelect;
type LedgerEntry = typeof schema.ledgerEntries.$inferSelect;
type Invoice = typeof schema.invoices.$inferSelect;
type Party = { id: string; name: string; businessName: string | null };

export type LeaseWithParties = Lease & { landlord: Party; tenant: Party | null };

const landlords = alias(schema.users, "landlord");
const tenants = alias(schema.users, "tenant");

export async function getLeasesForUser(userId: string): Promise<LeaseWithParties[]> {
  const rows = await db()
    .select({ lease: schema.leases, landlord: landlords, tenant: tenants })
    .from(schema.leases)
    .innerJoin(landlords, eq(schema.leases.landlordId, landlords.id))
    .leftJoin(tenants, eq(schema.leases.tenantId, tenants.id))
    .where(or(eq(schema.leases.landlordId, userId), eq(schema.leases.tenantId, userId)))
    .orderBy(asc(schema.leases.createdAt));
  const party = (u: typeof landlords.$inferSelect): Party => ({ id: u.id, name: u.name, businessName: u.businessName });
  return rows.map((r) => ({ ...r.lease, landlord: party(r.landlord), tenant: r.tenant ? party(r.tenant) : null }));
}

export function roleIn(lease: Lease, userId: string): "landlord" | "tenant" {
  return lease.landlordId === userId ? "landlord" : "tenant";
}

/**
 * Turn approved claims into next-invoice adjustments: when the tenant paid, the landlord's share
 * is credited back; when the landlord paid, the tenant's share is charged.
 */
export function adjustmentsFromClaims(lease: Pick<Lease, "landlordId">, claims: Claim[]): Adjustment[] {
  return claims.flatMap((c): Adjustment[] => {
    if (c.status !== "approved" || c.landlordShareCents == null || c.tenantShareCents == null) return [];
    const tenantPaid = c.submittedBy !== lease.landlordId;
    const amountCents = tenantPaid ? c.landlordShareCents : c.tenantShareCents;
    if (amountCents === 0) return [];
    return [
      tenantPaid
        ? { kind: "credit", amountCents, description: `Credit: ${c.title}`, claimId: c.id }
        : { kind: "charge", amountCents, description: `Charge: ${c.title}`, claimId: c.id },
    ];
  });
}

export type PeriodView = {
  period: string;
  label: string;
  entries: LedgerEntry[];
  balanceCents: Cents;
  invoice: Invoice | null;
};

export type LedgerView = {
  periods: PeriodView[]; // newest first
  balanceCents: Cents;
  upcoming: { period: string; label: string; invoice: RentInvoice };
  events: (typeof schema.events.$inferSelect)[];
};

export async function getLedger(lease: Lease): Promise<LedgerView> {
  const [entries, invoices, claims, events] = await Promise.all([
    db()
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.leaseId, lease.id))
      .orderBy(asc(schema.ledgerEntries.createdAt)),
    db().select().from(schema.invoices).where(eq(schema.invoices.leaseId, lease.id)),
    db().select().from(schema.claims).where(eq(schema.claims.leaseId, lease.id)),
    db()
      .select()
      .from(schema.events)
      .where(eq(schema.events.leaseId, lease.id))
      .orderBy(desc(schema.events.createdAt))
      .limit(50),
  ]);

  const byPeriod = new Map<string, LedgerEntry[]>();
  for (const e of entries) byPeriod.set(e.period, [...(byPeriod.get(e.period) ?? []), e]);

  const periods = [...byPeriod.keys()].sort().reverse().map((period) => {
    const periodEntries = byPeriod.get(period)!;
    return {
      period,
      label: formatPeriod(period),
      entries: periodEntries,
      balanceCents: sum(periodEntries.map((e) => e.amountCents)),
      invoice: invoices.find((i) => i.period === period) ?? null,
    };
  });

  return {
    periods,
    balanceCents: sum(entries.map((e) => e.amountCents)),
    upcoming: planNextInvoice(lease, entries, claims),
    events,
  };
}

/**
 * The next rent invoice: rent for the period after the last one billed, plus approved claims
 * and any credit carried over into that period. Used for the preview and to issue the invoice.
 */
export function planNextInvoice(lease: Lease, entries: LedgerEntry[], claims: Claim[]) {
  const lastRent = entries.filter((e) => e.kind === "rent").map((e) => e.period).sort().at(-1);
  const period = lastRent ? nextPeriod(lastRent) : periodOf(lease.startDate);
  const label = formatPeriod(period);
  const carriedOver: Adjustment[] = entries
    .filter((e) => e.kind === "carry_over" && e.period === period && e.invoiceId === null)
    .map((e) => ({ kind: "credit", amountCents: -e.amountCents, description: e.description, entryId: e.id }));
  return {
    period,
    label,
    invoice: buildRentInvoice({ name: `Rent – ${label}`, amountCents: lease.rentCents }, [...adjustmentsFromClaims(lease, claims), ...carriedOver]),
  };
}
