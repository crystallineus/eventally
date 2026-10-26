import { and, asc, desc, eq, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { formatUsd, splitByShare, type Cents } from "@/lib/money";
import type { User } from "@/lib/session";
import { putEvidence, type EvidenceKind } from "@/lib/storage";

type Claim = typeof schema.claims.$inferSelect;
type Lease = typeof schema.leases.$inferSelect;
export type Role = "landlord" | "tenant";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A claim plus the viewer's role, or null if it doesn't exist or the viewer isn't on the lease. */
export async function getClaimForUser(claimId: string, userId: string): Promise<{ claim: Claim; lease: Lease; role: Role } | null> {
  if (!UUID.test(claimId)) return null;
  const [row] = await db()
    .select({ claim: schema.claims, lease: schema.leases })
    .from(schema.claims)
    .innerJoin(schema.leases, eq(schema.claims.leaseId, schema.leases.id))
    .where(and(eq(schema.claims.id, claimId), or(eq(schema.leases.landlordId, userId), eq(schema.leases.tenantId, userId))));
  if (!row) return null;
  return { ...row, role: row.lease.landlordId === userId ? "landlord" : "tenant" };
}

export async function getClaimDetail(claimId: string) {
  const [evidence, events, people] = await Promise.all([
    db()
      .select({
        id: schema.evidence.id,
        kind: schema.evidence.kind,
        uploadedBy: schema.evidence.uploadedBy,
        mimeType: schema.evidence.mimeType,
        createdAt: schema.evidence.createdAt,
      })
      .from(schema.evidence)
      .where(eq(schema.evidence.claimId, claimId))
      .orderBy(asc(schema.evidence.createdAt)),
    db().select().from(schema.events).where(eq(schema.events.claimId, claimId)).orderBy(desc(schema.events.createdAt)),
    db().select({ id: schema.users.id, name: schema.users.name }).from(schema.users),
  ]);
  return { evidence, events, names: new Map(people.map((p) => [p.id, p.name])) };
}

export async function listClaims(leaseId: string) {
  return db().select().from(schema.claims).where(eq(schema.claims.leaseId, leaseId)).orderBy(desc(schema.claims.createdAt));
}

export type NewClaim = {
  leaseId: string;
  title: string;
  description: string;
  issueReportedAt: Date;
  amountCents: Cents;
  files: { kind: EvidenceKind; file: File }[];
};

export async function createClaim(user: User, input: NewClaim): Promise<string> {
  const [lease] = await db().select().from(schema.leases).where(eq(schema.leases.id, input.leaseId));
  if (!lease || (lease.landlordId !== user.id && lease.tenantId !== user.id)) throw new Error("Lease not found");

  return db().transaction(async (tx) => {
    const [claim] = await tx
      .insert(schema.claims)
      .values({
        leaseId: lease.id,
        submittedBy: user.id,
        title: input.title,
        description: input.description,
        issueReportedAt: input.issueReportedAt,
        amountCents: input.amountCents,
      })
      .returning();
    const stored = [];
    for (const f of input.files) stored.push(await putEvidence(tx, { claimId: claim.id, kind: f.kind, uploadedBy: user.id, file: f.file }));

    await tx.insert(schema.events).values({
      leaseId: lease.id,
      claimId: claim.id,
      actor: roleOf(lease, user.id),
      type: "claim.submitted",
      data: { by: user.name, title: claim.title, amountCents: claim.amountCents, evidence: stored.map((s) => s.kind) },
    });
    return claim.id;
  });
}

export async function addEvidence(user: User, claimId: string, files: { kind: EvidenceKind; file: File }[]) {
  const found = await getClaimForUser(claimId, user.id);
  if (!found) throw new Error("Claim not found");
  if (!isOpen(found.claim)) throw new Error("This claim is closed");

  await db().transaction(async (tx) => {
    const stored = [];
    for (const f of files) stored.push(await putEvidence(tx, { claimId, kind: f.kind, uploadedBy: user.id, file: f.file }));
    await tx.insert(schema.events).values({
      leaseId: found.lease.id,
      claimId,
      actor: found.role,
      type: "evidence.added",
      data: { by: user.name, kinds: stored.map((s) => s.kind) },
    });
    // The agent asked for more; new evidence sends the claim back for another review.
    if (found.claim.status === "needs_evidence") {
      await tx
        .update(schema.claims)
        .set({ status: "reviewing", reviewStartedAt: null, updatedAt: new Date() })
        .where(and(eq(schema.claims.id, claimId), eq(schema.claims.status, "needs_evidence")));
    }
  });
}

/**
 * Propose who pays what. Proposing counts as the proposer's approval; the other side must approve.
 * Any new proposal clears earlier approvals.
 */
export async function proposeSplit(user: User, claimId: string, landlordBasisPoints: number, rationale: string) {
  await db().transaction(async (tx) => {
    const [row] = await tx
      .select({ claim: schema.claims, lease: schema.leases })
      .from(schema.claims)
      .innerJoin(schema.leases, eq(schema.claims.leaseId, schema.leases.id))
      .where(eq(schema.claims.id, claimId))
      .for("update", { of: schema.claims });
    if (!row || roleOrNull(row.lease, user.id) === null) throw new Error("Claim not found");
    if (!isOpen(row.claim)) throw new Error("This claim is closed");
    if (row.claim.amountCents == null) throw new Error("Enter the receipt total first");

    const role = roleOf(row.lease, user.id);
    const { landlord, tenant } = splitByShare(row.claim.amountCents, landlordBasisPoints);
    const now = new Date();
    await tx
      .update(schema.claims)
      .set({
        status: "awaiting_approval",
        landlordShareCents: landlord,
        tenantShareCents: tenant,
        splitRationale: rationale,
        landlordApprovedAt: role === "landlord" ? now : null,
        tenantApprovedAt: role === "tenant" ? now : null,
        updatedAt: now,
      })
      .where(eq(schema.claims.id, claimId));
    await tx.insert(schema.events).values({
      leaseId: row.lease.id,
      claimId,
      actor: role,
      type: "split.proposed",
      data: { by: user.name, landlordShareCents: landlord, tenantShareCents: tenant, rationale },
    });
  });
}

export async function approveClaim(user: User, claimId: string) {
  await db().transaction(async (tx) => {
    // Lock the row so two approvals arriving together can't both miss each other.
    const [row] = await tx
      .select({ claim: schema.claims, lease: schema.leases })
      .from(schema.claims)
      .innerJoin(schema.leases, eq(schema.claims.leaseId, schema.leases.id))
      .where(eq(schema.claims.id, claimId))
      .for("update", { of: schema.claims });
    if (!row || roleOrNull(row.lease, user.id) === null) throw new Error("Claim not found");
    if (row.claim.status !== "awaiting_approval") throw new Error("There is no proposal to approve");

    const role = roleOf(row.lease, user.id);
    const now = new Date();
    const landlordApprovedAt = role === "landlord" ? now : row.claim.landlordApprovedAt;
    const tenantApprovedAt = role === "tenant" ? now : row.claim.tenantApprovedAt;
    const bothApproved = landlordApprovedAt !== null && tenantApprovedAt !== null;

    await tx
      .update(schema.claims)
      .set({ landlordApprovedAt, tenantApprovedAt, status: bothApproved ? "approved" : "awaiting_approval", updatedAt: now })
      .where(eq(schema.claims.id, claimId));
    // Record which split was approved, so the history still shows it if a new proposal replaces it.
    await tx.insert(schema.events).values({
      leaseId: row.lease.id,
      claimId,
      actor: role,
      type: "split.approved",
      data: { by: user.name, landlordShareCents: row.claim.landlordShareCents, tenantShareCents: row.claim.tenantShareCents },
    });
    if (bothApproved) {
      await tx.insert(schema.events).values({
        leaseId: row.lease.id,
        claimId,
        actor: "system",
        type: "claim.approved",
        data: {
          landlordShareCents: row.claim.landlordShareCents,
          tenantShareCents: row.claim.tenantShareCents,
          summary: `Both agreed: landlord pays ${formatUsd(row.claim.landlordShareCents ?? 0)}, tenant pays ${formatUsd(row.claim.tenantShareCents ?? 0)}. Added to the next rent invoice.`,
        },
      });
    }
  });
}

/**
 * The submitter corrects the claimed amount. Any proposed split was computed from the old amount,
 * so it and its approvals are cleared, and the claim goes back for a fresh AI review.
 */
export async function updateClaimAmount(user: User, claimId: string, amountCents: Cents) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("The amount must be more than $0");
  await db().transaction(async (tx) => {
    const [row] = await tx
      .select({ claim: schema.claims, lease: schema.leases })
      .from(schema.claims)
      .innerJoin(schema.leases, eq(schema.claims.leaseId, schema.leases.id))
      .where(eq(schema.claims.id, claimId))
      .for("update", { of: schema.claims });
    if (!row || row.claim.submittedBy !== user.id) throw new Error("Only the person who submitted a claim can change its amount");
    if (!isOpen(row.claim)) throw new Error("This claim is closed");
    if (row.claim.reviewStartedAt) throw new Error("The AI review is running. Try again when it finishes.");
    if (row.claim.amountCents === amountCents) return;

    await tx
      .update(schema.claims)
      .set({
        amountCents,
        status: "reviewing",
        landlordShareCents: null,
        tenantShareCents: null,
        splitRationale: null,
        landlordApprovedAt: null,
        tenantApprovedAt: null,
        reviewStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.claims.id, claimId));
    await tx.insert(schema.events).values({
      leaseId: row.lease.id,
      claimId,
      actor: roleOf(row.lease, user.id),
      type: "claim.amount_changed",
      data: { by: user.name, fromCents: row.claim.amountCents, toCents: amountCents },
    });
  });
}

export async function withdrawClaim(user: User, claimId: string) {
  const found = await getClaimForUser(claimId, user.id);
  if (!found || found.claim.submittedBy !== user.id) throw new Error("Only the person who submitted a claim can withdraw it");
  if (!isOpen(found.claim)) throw new Error("This claim is closed");
  await db().transaction(async (tx) => {
    await tx.update(schema.claims).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(schema.claims.id, claimId));
    await tx.insert(schema.events).values({ leaseId: found.lease.id, claimId, actor: found.role, type: "claim.withdrawn", data: { by: user.name } });
  });
}

/** Claims can change until both sides approve; after that they belong to an invoice. */
export function isOpen(claim: Pick<Claim, "status">) {
  return claim.status === "reviewing" || claim.status === "needs_evidence" || claim.status === "awaiting_approval";
}

function roleOrNull(lease: Lease, userId: string): Role | null {
  if (lease.landlordId === userId) return "landlord";
  if (lease.tenantId === userId) return "tenant";
  return null;
}

function roleOf(lease: Lease, userId: string): Role {
  const role = roleOrNull(lease, userId);
  if (!role) throw new Error("Not a party to this lease");
  return role;
}
