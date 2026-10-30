import { createHash } from "node:crypto";
import { eq, inArray, lt, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatUsd } from "@/lib/money";
import { formatPeriod, nextPeriod } from "@/lib/period";
import { putSampleEvidence } from "@/lib/storage";
import { todayInAppZone } from "@/lib/time";

// Each visitor gets a private copy of the demo: Tom (landlord), Maya (tenant), their lease, a few
// paid months, one settled claim and one claim waiting for Tom's approval. The review results are
// written out here, so starting a demo makes no AI calls. Photos are shared (demo_photos).
// Names, address, businesses and amounts are fictional demo data.

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export const DEMO_DAYS = 7;

/** Sample files in public/demo/, also offered to visitors for trying their own claim. */
export const SAMPLE_PHOTOS = [
  "plumbing-receipt.jpg",
  "sink-before.jpeg",
  "sink-after.jpeg",
  "hardware-receipt.jpg",
  "screen-before.jpeg",
  "screen-after.jpeg",
  "range-hood-receipt.jpg",
] as const;

/** Store the sample photos once. `load` returns a file's bytes (from disk in the seed, over HTTP in the app). */
export async function ensureSamplePhotos(load: (name: string) => Promise<Buffer>) {
  const have = new Set((await db().select({ name: schema.demoPhotos.name }).from(schema.demoPhotos)).map((p) => p.name));
  for (const name of SAMPLE_PHOTOS.filter((n) => !have.has(n))) {
    const data = await load(name);
    await db()
      .insert(schema.demoPhotos)
      .values({ name, mimeType: "image/jpeg", data, sha256: createHash("sha256").update(data).digest("hex") })
      .onConflictDoNothing();
  }
}

const REPAIR_CLAUSE = `12. Repairs and Maintenance.
(a) Landlord shall keep the plumbing, electrical, heating, and supplied appliances in good working order and shall pay for repairs to them, except where the damage was caused by Tenant, Tenant's guests, or Tenant's pets.
(b) Tenant shall pay for repairs of damage caused by Tenant, Tenant's guests, or Tenant's pets, including damage to window screens, doors, and walls.
(c) If Landlord authorizes Tenant to arrange a repair that is Landlord's responsibility, Landlord shall reimburse Tenant's reasonable, receipted costs.`;

const RENT = 200000;
const at = (iso: string) => new Date(iso);
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const pass = (summary: string) => ({ status: "pass", summary });

/** Create a fresh demo and return its id and people. */
export async function createDemo() {
  const merchantEmail = process.env.PAYPAL_SANDBOX_MERCHANT_EMAIL;
  const buyerEmail = process.env.PAYPAL_SANDBOX_BUYER_EMAIL;
  if (!merchantEmail || !buyerEmail) throw new Error("Set PAYPAL_SANDBOX_MERCHANT_EMAIL and PAYPAL_SANDBOX_BUYER_EMAIL");

  return db().transaction(async (tx) => {
    const [demo] = await tx.insert(schema.demos).values({}).returning();
    const [tom, maya] = await tx
      .insert(schema.users)
      .values([
        // Tom's bell starts with the sink claim unread: it's waiting for him.
        { demoId: demo.id, name: "Tom Becker", email: "tom@eventally.demo", businessName: "SJ Rentals", paypalEmail: merchantEmail, notificationsSeenAt: hoursAgo(30) },
        { demoId: demo.id, name: "Maya Chen", email: "maya@eventally.demo", paypalEmail: buyerEmail, notificationsSeenAt: new Date() },
      ])
      .returning();

    const [lease] = await tx
      .insert(schema.leases)
      .values({
        propertyName: "Maple Street Apartment",
        address: "418 Maple Street, Apt 2B, San Jose, CA 95112",
        landlordId: tom.id,
        tenantId: maya.id,
        rentCents: RENT,
        depositCents: RENT,
        dueDay: 1,
        startDate: "2026-06-01",
        endDate: "2027-05-31",
        repairClause: REPAIR_CLAUSE,
        createdAt: at("2026-05-20T17:00:00Z"),
      })
      .returning();
    await tx.insert(schema.events).values({
      leaseId: lease.id,
      actor: "system",
      type: "lease.created",
      data: { landlord: tom.name, tenant: maya.name, rentCents: RENT },
      createdAt: at("2026-05-20T17:00:00Z"),
    });

    const screen = await settledScreenClaim(tx, lease.id, tom.id);
    await paidMonths(tx, lease.id, screen);
    await sinkClaimAwaitingTom(tx, lease.id, maya.id);
    return { demoId: demo.id, tomId: tom.id, mayaId: maya.id };
  });
}

/**
 * Rent from October 2026 through the current month, all paid. The screen charge is on November's
 * invoice. Later months follow the visit date, so the next invoice is always next month.
 */
async function paidMonths(tx: Tx, leaseId: string, screen: { claimId: string; title: string }) {
  const current = todayInAppZone().slice(0, 7);
  const last = current > "2026-11" ? current : "2026-11";
  for (let period = "2026-10"; period <= last; period = nextPeriod(period)) {
    const withScreen = period === "2026-11";
    const total = RENT + (withScreen ? 4500 : 0);
    const paidAt = at(`${period}-01T17:30:00Z`);
    const [invoice] = await tx.insert(schema.invoices).values({ leaseId, period, status: "paid", totalCents: total, paidAt, createdAt: paidAt }).returning();
    const label = formatPeriod(period);
    await tx.insert(schema.ledgerEntries).values([
      { leaseId, period, kind: "rent" as const, amountCents: RENT, description: `Rent – ${label}`, invoiceId: invoice.id, createdAt: paidAt },
      ...(withScreen ? [{ leaseId, period, kind: "charge" as const, amountCents: 4500, description: `Charge: ${screen.title}`, claimId: screen.claimId, invoiceId: invoice.id, createdAt: paidAt }] : []),
      { leaseId, period, kind: "payment" as const, amountCents: -total, description: `PayPal payment – ${label}`, invoiceId: invoice.id, createdAt: paidAt },
    ]);
    await tx.insert(schema.events).values({
      leaseId,
      actor: "paypal",
      type: "invoice.paid",
      data: { totalCents: total, paidCents: total, source: "webhook", summary: `Paid ${formatUsd(total)} through PayPal.` },
      createdAt: paidAt,
    });
  }
}

/** Tom rescreened a window Maya's cat tore; both agreed Maya pays, and it was on November's rent. */
async function settledScreenClaim(tx: Tx, leaseId: string, tomId: string) {
  const title = "Torn window screen";
  const rationale =
    "Tom's Alder Street Hardware receipt dated 2026-10-24 totals $45.00 for screen materials, and the before and after photos show the torn screen and the new one. Tom says Maya's cat tore it, and the lease puts damage to window screens caused by a tenant's pet on the tenant.";
  const citation = `Lease Section 12(b): "Tenant shall pay for repairs of damage caused by Tenant, Tenant's guests, or Tenant's pets, including damage to window screens, doors, and walls."`;
  const [claim] = await tx
    .insert(schema.claims)
    .values({
      leaseId,
      submittedBy: tomId,
      title,
      description: "Maya's cat tore the living-room window screen. I bought the materials and rescreened it myself.",
      issueReportedAt: at("2026-10-23T12:00:00Z"),
      status: "settled",
      amountCents: 4500,
      landlordShareCents: 0,
      tenantShareCents: 4500,
      splitRationale: `${rationale}\n\nLease: ${citation}`,
      landlordApprovedAt: at("2026-10-25T18:10:00Z"),
      tenantApprovedAt: at("2026-10-25T20:40:00Z"),
      createdAt: at("2026-10-24T23:30:00Z"),
      updatedAt: at("2026-11-01T17:30:00Z"),
    })
    .returning();
  const receipt = await putSampleEvidence(tx, {
    claimId: claim.id,
    kind: "receipt",
    uploadedBy: tomId,
    photo: "hardware-receipt.jpg",
    createdAt: claim.createdAt,
    extracted: {
      merchant: "Alder Street Hardware",
      date: "2026-10-24",
      legible: true,
      taxCents: 386,
      totalCents: 4500,
      lineItems: [
        { description: "Fiberglass screen 36x84 gray", amountCents: 1298 },
        { description: "Screen spline .175 25ft", amountCents: 648 },
        { description: "Spline roller tool", amountCents: 897 },
        { description: "Screen frame kit 48in white", amountCents: 1271 },
      ],
    },
  });
  await putSampleEvidence(tx, { claimId: claim.id, kind: "before", uploadedBy: tomId, photo: "screen-before.jpeg", createdAt: claim.createdAt });
  await putSampleEvidence(tx, { claimId: claim.id, kind: "after", uploadedBy: tomId, photo: "screen-after.jpeg", createdAt: claim.createdAt });

  await claimEvents(tx, leaseId, claim.id, at("2026-10-24T23:30:00Z"), [
    ["landlord", "claim.submitted", { by: "Tom Becker", title, amountCents: 4500, evidence: ["receipt", "before", "after"] }],
    ...review({
      receipt: {
        evidenceId: receipt.id,
        merchant: "Alder Street Hardware",
        date: "2026-10-24",
        total: "45.00",
        tax: "3.86",
        items: [
          ["Fiberglass screen 36x84 gray", "12.98"],
          ["Screen spline .175 25ft", "6.48"],
          ["Spline roller tool", "8.97"],
          ["Screen frame kit 48in white", "12.71"],
        ],
      },
      math: "Line items add up to the receipt total of $45.00, which matches the claim.",
      dates: "The receipt (Oct 24, 2026) is on or after the day the problem was reported and within the lease term.",
      photos: "The before photo shows a hole torn in the fiberglass screen; the after photo shows the window rescreened, which matches the materials on the receipt.",
      estimate: { category: "window_screen_repair", summary: "Estimate only: Window screen repair or rescreen usually runs $25.00–$90.00 around San Jose." },
      split: { percent: 0, landlord: 0, tenant: 4500, rationale, citation, why: "Section 12(b) assigns pet damage to window screens to the tenant." },
    }),
    ["landlord", "split.approved", { by: "Tom Becker", landlordShareCents: 0, tenantShareCents: 4500 }],
    ["tenant", "split.approved", { by: "Maya Chen", landlordShareCents: 0, tenantShareCents: 4500 }],
    ["system", "claim.approved", { summary: "Both agreed: landlord pays $0.00, tenant pays $45.00. Added to the next rent invoice.", landlordShareCents: 0, tenantShareCents: 4500 }],
  ]);
  return { claimId: claim.id, title };
}

/** Maya paid a plumber while Tom was away; the review proposes Tom pays it all, and Maya has agreed. */
async function sinkClaimAwaitingTom(tx: Tx, leaseId: string, mayaId: string) {
  const title = "Kitchen sink leak";
  const rationale =
    "The Maple Leaf Plumbing & Drain invoice dated 2026-10-21 totals $240.00 and its line items add up. The before photo shows the leak under the kitchen sink and the after photo shows the new P-trap. The lease makes the landlord responsible for plumbing unless the tenant caused the damage, and nothing suggests Maya did; Tom asked her to arrange the repair, which Section 12(c) covers.";
  const citation = `Lease Section 12(a): "Landlord shall keep the plumbing, electrical, heating, and supplied appliances in good working order and shall pay for repairs to them, except where the damage was caused by Tenant, Tenant's guests, or Tenant's pets." Section 12(c): Landlord reimburses receipted costs of a repair the Landlord authorized the Tenant to arrange.`;
  const submitted = hoursAgo(28);
  const [claim] = await tx
    .insert(schema.claims)
    .values({
      leaseId,
      submittedBy: mayaId,
      title,
      description: "Water was leaking from the pipe under the kitchen sink. Tom was traveling and asked me to call a plumber, who replaced the corroded P-trap.",
      issueReportedAt: at("2026-10-20T12:00:00Z"),
      status: "awaiting_approval",
      amountCents: 24000,
      landlordShareCents: 24000,
      tenantShareCents: 0,
      splitRationale: `${rationale}\n\nLease: ${citation}`,
      tenantApprovedAt: hoursAgo(26),
      createdAt: submitted,
      updatedAt: hoursAgo(26),
    })
    .returning();
  const receipt = await putSampleEvidence(tx, {
    claimId: claim.id,
    kind: "receipt",
    uploadedBy: mayaId,
    photo: "plumbing-receipt.jpg",
    createdAt: submitted,
    extracted: {
      merchant: "Maple Leaf Plumbing & Drain",
      date: "2026-10-21",
      legible: true,
      taxCents: 514,
      totalCents: 24000,
      lineItems: [
        { description: "Labor (1.5 hours at 120.00)", amountCents: 18000 },
        { description: '1-1/2" PVC P-trap kit', amountCents: 4198 },
        { description: 'Slip-joint washers & nuts, 1-1/2" (2 at 6.44)', amountCents: 1288 },
      ],
    },
  });
  await putSampleEvidence(tx, { claimId: claim.id, kind: "before", uploadedBy: mayaId, photo: "sink-before.jpeg", createdAt: submitted });
  await putSampleEvidence(tx, { claimId: claim.id, kind: "after", uploadedBy: mayaId, photo: "sink-after.jpeg", createdAt: submitted });

  await claimEvents(tx, leaseId, claim.id, submitted, [
    ["tenant", "claim.submitted", { by: "Maya Chen", title, amountCents: 24000, evidence: ["receipt", "before", "after"], wantsPayout: false }],
    ...review({
      receipt: {
        evidenceId: receipt.id,
        merchant: "Maple Leaf Plumbing & Drain",
        date: "2026-10-21",
        total: "240.00",
        tax: "5.14",
        items: [
          ["Labor (1.5 hours at 120.00)", "180.00"],
          ['1-1/2" PVC P-trap kit', "41.98"],
          ['Slip-joint washers & nuts, 1-1/2" (2 at 6.44)', "12.88"],
        ],
      },
      math: "Line items add up to the receipt total of $240.00, which matches the claim.",
      dates: "The receipt (Oct 21, 2026) is on or after the day the problem was reported and within the lease term.",
      photos: "The before photo shows water pooling under a corroded P-trap; the after photo shows a new PVC P-trap installed and the cabinet dry, which matches the work on the invoice.",
      estimate: { category: "plumber_service_call", summary: "Estimate only: Plumber visit for a small fix, labor only usually runs $120.00–$350.00 around San Jose." },
      split: { percent: 100, landlord: 24000, tenant: 0, rationale, citation, why: "Plumbing is the landlord's under Section 12(a), and Tom authorized the repair under 12(c)." },
    }),
    ["tenant", "split.approved", { by: "Maya Chen", landlordShareCents: 24000, tenantShareCents: 0 }],
  ]);
}

type Review = {
  receipt: { evidenceId: string; merchant: string; date: string; total: string; tax: string; items: [string, string][] };
  math: string;
  dates: string;
  photos: string;
  estimate: { category: string; summary: string };
  split: { percent: number; landlord: number; tenant: number; rationale: string; citation: string; why: string };
};

/** A finished review as the agent would have logged it. */
function review(r: Review): [string, string, Record<string, unknown>][] {
  return [
    ["agent", "agent.review_started", { note: "Aunt Tally started reviewing this claim." }],
    [
      "agent",
      "agent.record_receipt",
      {
        why: "I need to read the receipt before any other check can run.",
        input: {
          evidence_id: r.receipt.evidenceId,
          merchant: r.receipt.merchant,
          date: r.receipt.date,
          line_items: r.receipt.items.map(([description, amount]) => ({ description, amount })),
          tax: r.receipt.tax,
          total: r.receipt.total,
          legible: true,
          other_amounts: [],
        },
        result: pass(`Read a receipt from ${r.receipt.merchant} dated ${r.receipt.date} for $${r.receipt.total}.`),
      },
    ],
    ["agent", "agent.check_math", { why: "The line items need to add up to the receipt total, and the total needs to match the amount claimed.", input: {}, result: pass(r.math) }],
    ["agent", "agent.check_dates", { why: "The receipt date needs to fall after the problem was reported and within the lease term.", input: {}, result: pass(r.dates) }],
    ["agent", "agent.check_duplicate", { why: "This checks whether the same receipt was already submitted on this lease.", input: {}, result: pass("No matching receipt or photo found in other claims on this lease.") }],
    ["agent", "agent.assess_photos", { why: "The photos need to show the problem and the finished repair the receipt bills for.", input: pass(r.photos), result: pass(r.photos) }],
    ["agent", "agent.estimate_price", { why: "A rough reference range helps both sides judge the cost.", input: { category: r.estimate.category }, result: { ...pass(r.estimate.summary), estimate: true } }],
    [
      "agent",
      "agent.propose_split",
      {
        why: r.split.why,
        input: { landlord_percent: r.split.percent, rationale: r.split.rationale, lease_citation: r.split.citation },
        result: {
          ...pass(`Proposed: landlord pays ${formatUsd(r.split.landlord)}, tenant pays ${formatUsd(r.split.tenant)}.`),
          rationale: r.split.rationale,
          leaseCitation: r.split.citation,
          landlordShareCents: r.split.landlord,
          tenantShareCents: r.split.tenant,
        },
      },
    ],
    ["agent", "agent.review_finished", { outcome: "proposed", model: "prepared demo data" }],
  ];
}

/** Insert a claim's events a couple of minutes apart, starting at `start`. */
async function claimEvents(tx: Tx, leaseId: string, claimId: string, start: Date, events: [string, string, Record<string, unknown>][]) {
  await tx.insert(schema.events).values(
    events.map(([actor, type, data], i) => ({
      leaseId,
      claimId,
      actor: actor as (typeof schema.eventActor.enumValues)[number],
      type,
      data,
      createdAt: new Date(start.getTime() + i * 90_000),
    })),
  );
}

/** Remove a demo and everything in it. */
export async function deleteDemo(demoId: string) {
  await db().transaction(async (tx) => {
    const users = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.demoId, demoId));
    const userIds = users.map((u) => u.id);
    if (userIds.length) {
      const leases = await tx
        .select({ id: schema.leases.id })
        .from(schema.leases)
        .where(or(inArray(schema.leases.landlordId, userIds), inArray(schema.leases.tenantId, userIds)));
      const leaseIds = leases.map((l) => l.id);
      if (leaseIds.length) {
        const claimIds = (await tx.select({ id: schema.claims.id }).from(schema.claims).where(inArray(schema.claims.leaseId, leaseIds))).map((c) => c.id);
        await tx.delete(schema.events).where(inArray(schema.events.leaseId, leaseIds));
        await tx.delete(schema.payouts).where(inArray(schema.payouts.leaseId, leaseIds));
        await tx.delete(schema.ledgerEntries).where(inArray(schema.ledgerEntries.leaseId, leaseIds));
        if (claimIds.length) await tx.delete(schema.evidence).where(inArray(schema.evidence.claimId, claimIds));
        await tx.delete(schema.claims).where(inArray(schema.claims.leaseId, leaseIds));
        await tx.delete(schema.invoices).where(inArray(schema.invoices.leaseId, leaseIds));
        await tx.delete(schema.leases).where(inArray(schema.leases.id, leaseIds));
      }
      await tx.delete(schema.users).where(inArray(schema.users.id, userIds));
    }
    await tx.delete(schema.demos).where(eq(schema.demos.id, demoId));
  });
}

/** Delete demos older than DEMO_DAYS, a few at a time (called when a new demo starts). */
export async function deleteOldDemos(limit = 5) {
  const cutoff = new Date(Date.now() - DEMO_DAYS * 24 * 3600_000);
  const old = await db().select({ id: schema.demos.id }).from(schema.demos).where(lt(schema.demos.createdAt, cutoff)).limit(limit);
  for (const d of old) await deleteDemo(d.id);
  return old.length;
}
