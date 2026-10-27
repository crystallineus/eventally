// Resets the database to the demo starting point: Tom (landlord), Maya (tenant), one lease,
// and October rent already paid. WIPES ALL DATA. Usage: npm run db:seed
// Names, address and amounts are fictional demo data.
import { sql } from "drizzle-orm";
import { db, schema } from "../lib/db";

const merchantEmail = process.env.PAYPAL_SANDBOX_MERCHANT_EMAIL;
const buyerEmail = process.env.PAYPAL_SANDBOX_BUYER_EMAIL;
if (!merchantEmail || !buyerEmail) throw new Error("Set the PayPal sandbox emails in .env first");

const REPAIR_CLAUSE = `12. Repairs and Maintenance.
(a) Landlord shall keep the plumbing, electrical, heating, and supplied appliances in good working order and shall pay for repairs to them, except where the damage was caused by Tenant, Tenant's guests, or Tenant's pets.
(b) Tenant shall pay for repairs of damage caused by Tenant, Tenant's guests, or Tenant's pets, including damage to window screens, doors, and walls.
(c) If Landlord authorizes Tenant to arrange a repair that is Landlord's responsibility, Landlord shall reimburse Tenant's reasonable, receipted costs.`;

async function main() {
  await db().transaction(async (tx) => {
    await tx.execute(
      sql`truncate ${schema.events}, ${schema.ledgerEntries}, ${schema.invoices}, ${schema.evidence}, ${schema.claims}, ${schema.leases}, ${schema.users} cascade`,
    );

    const [tom, maya] = await tx
      .insert(schema.users)
      .values([
        { name: "Tom Becker", email: "tom@eventally.demo", businessName: "SJ Rentals", paypalEmail: merchantEmail },
        { name: "Maya Chen", email: "maya@eventally.demo", paypalEmail: buyerEmail },
      ])
      .returning();

    const [lease] = await tx
      .insert(schema.leases)
      .values({
        propertyName: "Maple Street Apartment",
        address: "418 Maple Street, Apt 2B, San Jose, CA 95112",
        landlordId: tom.id,
        tenantId: maya.id,
        rentCents: 200000,
        depositCents: 200000,
        dueDay: 1,
        startDate: "2026-06-01",
        endDate: "2027-05-31",
        repairClause: REPAIR_CLAUSE,
      })
      .returning();

    await tx.insert(schema.ledgerEntries).values([
      { leaseId: lease.id, period: "2026-10", kind: "rent", amountCents: 200000, description: "Rent – October 2026" },
      { leaseId: lease.id, period: "2026-10", kind: "payment", amountCents: -200000, description: "PayPal payment – October 2026" },
    ]);

    await tx.insert(schema.events).values({
      leaseId: lease.id,
      actor: "system",
      type: "lease.created",
      data: { landlord: tom.name, tenant: maya.name, rentCents: lease.rentCents },
    });

    console.log(`Seeded lease ${lease.id}: ${tom.name} → ${maya.name}, rent $2,000.00, October paid`);
  });
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
