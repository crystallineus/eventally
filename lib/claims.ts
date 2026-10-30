import { and, asc, count, desc, eq, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { viaMeta } from "@/lib/via";
import { formatUsd, splitByShare, type Cents } from "@/lib/money";
import type { User } from "@/lib/session";
import { putEvidence, type EvidenceKind } from "@/lib/storage";
import { ASSISTANT } from "@/lib/persona";
import { todayInAppZone } from "@/lib/time";

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
  /** Null: unknown yet, filled from the receipt by the review. */
  issueReportedAt: Date | null;
  amountCents: Cents | null;
  /** Tenant only: ask to be paid back via PayPal right away instead of a rent credit. */
  tenantWantsPayout?: boolean;
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
        tenantWantsPayout: user.id === lease.tenantId && !!input.tenantWantsPayout,
      })
      .returning();
    const stored = [];
    for (const f of input.files) stored.push(await putEvidence(tx, { claimId: claim.id, kind: f.kind, uploadedBy: user.id, file: f.file }));

    await tx.insert(schema.events).values({
      leaseId: lease.id,
      claimId: claim.id,
      actor: roleOf(lease, user.id),
      type: "claim.submitted",
      data: { ...viaMeta(), by: user.name, title: claim.title, amountCents: claim.amountCents, evidence: stored.map((s) => s.kind), wantsPayout: claim.tenantWantsPayout },
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
      data: { ...viaMeta(), by: user.name, kinds: stored.map((s) => s.kind) },
    });
    // New evidence doesn't start a review by itself: people finish their changes, then use
    // requestReview ("Review again").
    if (found.claim.status === "awaiting_approval") await clearApprovals(tx, claimId);
  });
}

/**
 * The uploader removes one of their photos while the claim is still being agreed. The file is
 * deleted outright (it may have been uploaded by mistake); the log keeps who removed what kind,
 * and its hash.
 */
export async function removeEvidence(user: User, evidenceId: string) {
  if (!UUID.test(evidenceId)) throw new Error("Photo not found");
  const [item] = await db()
    .select({ id: schema.evidence.id, claimId: schema.evidence.claimId, kind: schema.evidence.kind, uploadedBy: schema.evidence.uploadedBy, sha256: schema.evidence.sha256 })
    .from(schema.evidence)
    .where(eq(schema.evidence.id, evidenceId));
  const found = item && (await getClaimForUser(item.claimId, user.id));
  if (!item || !found) throw new Error("Photo not found");
  if (item.uploadedBy !== user.id) throw new Error("Only the person who uploaded a photo can remove it");
  if (!isOpen(found.claim)) throw new Error("This claim is closed");
  if (found.claim.reviewStartedAt) throw new Error(`${ASSISTANT.name} is still reviewing. Try again when she finishes.`);

  await db().transaction(async (tx) => {
    if (item.kind === "receipt") {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(schema.evidence)
        .where(and(eq(schema.evidence.claimId, item.claimId), eq(schema.evidence.kind, "receipt")));
      if (n <= 1) throw new Error("A claim needs a receipt. Upload the right one first, then remove this one.");
    }
    await tx.delete(schema.evidence).where(eq(schema.evidence.id, item.id));
    await tx.insert(schema.events).values({
      leaseId: found.lease.id,
      claimId: item.claimId,
      actor: found.role,
      type: "evidence.removed",
      data: { ...viaMeta(), by: user.name, kind: item.kind, sha256: item.sha256 },
    });
    if (found.claim.status === "awaiting_approval") await clearApprovals(tx, item.claimId);
  });
}

/** Evidence changed after a split was proposed, so earlier approvals no longer reflect it. */
async function clearApprovals(tx: Pick<ReturnType<typeof db>, "update">, claimId: string) {
  await tx
    .update(schema.claims)
    .set({ landlordApprovedAt: null, tenantApprovedAt: null, updatedAt: new Date() })
    .where(eq(schema.claims.id, claimId));
}

/** Most AI reviews one claim gets. After that, the parties settle the split themselves. */
export const MAX_REVIEWS = 3;

export async function reviewCount(claimId: string): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(schema.events)
    .where(and(eq(schema.events.claimId, claimId), eq(schema.events.type, "agent.review_started")));
  return row?.n ?? 0;
}

/**
 * Either party sends a claim back to the AI, up to MAX_REVIEWS: when it's waiting for changes, or
 * when evidence changed after a proposal. A pending proposal is cleared (it stays in the history)
 * so the review starts from the current evidence.
 */
export async function requestReview(user: User, claimId: string) {
  const found = await getClaimForUser(claimId, user.id);
  if (!found) throw new Error("Claim not found");
  const from = found.claim.status;
  if (from !== "needs_evidence" && from !== "awaiting_approval") throw new Error("This claim can't be reviewed again now");
  if ((await reviewCount(claimId)) >= MAX_REVIEWS) throw new Error(`${ASSISTANT.name} has already reviewed this claim ${MAX_REVIEWS} times`);

  await db().transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.claims)
      .set({
        status: "reviewing",
        reviewStartedAt: null,
        landlordShareCents: null,
        tenantShareCents: null,
        splitRationale: null,
        landlordApprovedAt: null,
        tenantApprovedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.claims.id, claimId), eq(schema.claims.status, from)))
      .returning({ id: schema.claims.id });
    if (!updated) return;
    await tx.insert(schema.events).values({ leaseId: found.lease.id, claimId, actor: found.role, type: "claim.review_requested", data: { ...viaMeta(), by: user.name } });
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
      data: { ...viaMeta(), by: user.name, landlordShareCents: landlord, tenantShareCents: tenant, rationale },
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
    // Already approved (e.g. a double click): nothing to change, nothing to log.
    if ((role === "landlord" ? row.claim.landlordApprovedAt : row.claim.tenantApprovedAt) !== null) return;
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
      data: { ...viaMeta(), by: user.name, landlordShareCents: row.claim.landlordShareCents, tenantShareCents: row.claim.tenantShareCents },
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
 * so it and its approvals are cleared; the claim then waits for changes until someone asks for a
 * new AI review.
 */
export async function updateClaimAmount(user: User, claimId: string, amountCents: Cents) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("The amount must be more than $0");
  await changeSubmittedFact(user, claimId, "amount", (claim) =>
    claim.amountCents === amountCents
      ? null
      : { set: { amountCents }, type: "claim.amount_changed", data: { fromCents: claim.amountCents, toCents: amountCents } },
  );
}

/** Correct the day the problem was reported (YYYY-MM-DD); the date check depends on it. */
export async function updateIssueDate(user: User, claimId: string, isoDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || Number.isNaN(Date.parse(isoDate))) throw new Error("Pick a date");
  if (isoDate > todayInAppZone()) throw new Error("The date can't be in the future");
  const issueReportedAt = new Date(`${isoDate}T12:00:00Z`);
  await changeSubmittedFact(user, claimId, "date", (claim) => {
    const from = claim.issueReportedAt?.toISOString().slice(0, 10) ?? null;
    return from === isoDate ? null : { set: { issueReportedAt }, type: "claim.date_changed", data: { from, to: isoDate } };
  });
}

/**
 * The submitter corrects something the review relies on (amount, date). Any proposed split is
 * cleared and the claim waits for "Review again", unless the first review hasn't run yet.
 */
async function changeSubmittedFact(
  user: User,
  claimId: string,
  what: string,
  change: (claim: Claim) => { set: Partial<Claim>; type: string; data: Record<string, unknown> } | null,
) {
  await db().transaction(async (tx) => {
    const [row] = await tx
      .select({ claim: schema.claims, lease: schema.leases })
      .from(schema.claims)
      .innerJoin(schema.leases, eq(schema.claims.leaseId, schema.leases.id))
      .where(eq(schema.claims.id, claimId))
      .for("update", { of: schema.claims });
    if (!row || row.claim.submittedBy !== user.id) throw new Error(`Only the person who submitted a claim can change its ${what}`);
    if (!isOpen(row.claim)) throw new Error("This claim is closed");
    if (row.claim.reviewStartedAt) throw new Error(`${ASSISTANT.name} is still reviewing. Try again when she finishes.`);
    const changed = change(row.claim);
    if (!changed) return;

    await tx
      .update(schema.claims)
      .set({
        ...changed.set,
        status: row.claim.status === "reviewing" ? "reviewing" : "needs_evidence",
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
      type: changed.type,
      data: { ...viaMeta(), by: user.name, ...changed.data },
    });
  });
}

/** The tenant who submitted a claim changes how they'd like to be paid back, until both sides approve. */
export async function setPayoutPreference(user: User, claimId: string, wantsPayout: boolean) {
  const found = await getClaimForUser(claimId, user.id);
  if (!found || found.claim.submittedBy !== user.id || found.role !== "tenant") throw new Error("Only the tenant who submitted the claim can change this");
  // The landlord approved with this preference in view, so it's fixed once both sides agree.
  if (!isOpen(found.claim)) throw new Error("Both of you already approved this claim, so the payback preference can't change");
  if (found.claim.tenantWantsPayout === wantsPayout) return;
  await db().transaction(async (tx) => {
    await tx.update(schema.claims).set({ tenantWantsPayout: wantsPayout, updatedAt: new Date() }).where(eq(schema.claims.id, claimId));
    await tx.insert(schema.events).values({ leaseId: found.lease.id, claimId, actor: "tenant", type: "claim.payout_preference", data: { ...viaMeta(), by: user.name, wantsPayout } });
  });
}

export async function withdrawClaim(user: User, claimId: string) {
  const found = await getClaimForUser(claimId, user.id);
  if (!found || found.claim.submittedBy !== user.id) throw new Error("Only the person who submitted a claim can withdraw it");
  if (!isOpen(found.claim)) throw new Error("This claim is closed");
  await db().transaction(async (tx) => {
    await tx.update(schema.claims).set({ status: "withdrawn", updatedAt: new Date() }).where(eq(schema.claims.id, claimId));
    await tx.insert(schema.events).values({ leaseId: found.lease.id, claimId, actor: found.role, type: "claim.withdrawn", data: { ...viaMeta(), by: user.name } });
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
