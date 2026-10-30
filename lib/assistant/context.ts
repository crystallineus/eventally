import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { planNextInvoice } from "@/lib/ledger";
import { formatUsd } from "@/lib/money";
import { formatPeriod } from "@/lib/period";

// Facts the assistant can look up about one lease, from our own database. Amounts are returned
// both as display strings and API values so the money guard can recognise them in her reply.

type Lease = typeof schema.leases.$inferSelect;
type Role = "landlord" | "tenant";

const dueDate = (lease: Lease, period: string) => `${period}-${String(lease.dueDay).padStart(2, "0")}`;

const CLAIM_STATUS: Record<string, string> = {
  reviewing: "Aunt Tally is reviewing it",
  needs_evidence: "waiting for changes or more evidence",
  awaiting_approval: "a split is proposed, waiting for approval",
  approved: "both approved, goes on the next rent invoice",
  invoiced: "on a rent invoice (agreed, final)",
  settled: "settled (final)",
  withdrawn: "withdrawn",
  paid_out: "the landlord paid it back via PayPal (final)",
};

type Claim = typeof schema.claims.$inferSelect;

function claimSummary(lease: Lease, c: Claim) {
  const tenantFronted = c.submittedBy !== lease.landlordId;
  return {
    title: c.title,
    status: CLAIM_STATUS[c.status] ?? c.status,
    // Who paid the repair bill up front is not who ends up bearing the cost; say both plainly.
    paid_up_front_by: tenantFronted ? "tenant (paid the repair bill and is being reimbursed)" : "landlord (paid the repair bill and is charging the tenant's share)",
    receipt_total: c.amountCents == null ? "not known yet (read from the receipt during review)" : formatUsd(c.amountCents),
    split: c.landlordShareCents == null ? "no split proposed yet" : `landlord bears ${formatUsd(c.landlordShareCents)}, tenant bears ${formatUsd(c.tenantShareCents ?? 0)}`,
    link: `/claims/${c.id}`,
  };
}

/**
 * Everything on the ledger for one month (rent, payments, repair charges and credits, PayPal payouts),
 * plus the rent invoice if one was sent. With no month, the latest month on the ledger; a month
 * that hasn't been billed yet shows the next invoice preview.
 */
export async function explainMonth(lease: Lease, period?: string) {
  const [invoices, entries, claims] = await Promise.all([
    db().select().from(schema.invoices).where(eq(schema.invoices.leaseId, lease.id)),
    db().select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.leaseId, lease.id)).orderBy(asc(schema.ledgerEntries.createdAt)),
    db().select().from(schema.claims).where(eq(schema.claims.leaseId, lease.id)),
  ]);
  const plan = planNextInvoice(lease, entries, claims);
  const months = [...new Set(entries.map((e) => e.period))].sort();
  const month = period ?? months.at(-1) ?? plan.period;
  const claimFor = (id: string | null) => {
    const c = claims.find((x) => x.id === id);
    return c ? claimSummary(lease, c) : null;
  };

  const monthEntries = entries.filter((e) => e.period === month);
  if (monthEntries.length === 0) {
    if (month !== plan.period) return { error: `There's nothing on the ledger for ${formatPeriod(month)}.`, months_on_ledger: months.map(formatPeriod) };
    return {
      month: plan.label,
      status: "not billed yet (preview of the next invoice)",
      due_date: dueDate(lease, plan.period),
      total: formatUsd(plan.invoice.totalCents),
      lines: plan.invoice.lines.map((l) => ({ name: l.name, amount: formatUsd(l.amountCents), claim: claimFor(l.claimId ?? null) })),
      credit_carried_to_next_month: plan.invoice.carryOverCents ? formatUsd(plan.invoice.carryOverCents) : null,
      link: `/ledger?lease=${lease.id}`,
    };
  }

  const invoice = invoices.find((i) => i.period === month);
  const balance = monthEntries.reduce((sum, e) => sum + e.amountCents, 0);
  return {
    month: formatPeriod(month),
    due_date: dueDate(lease, month),
    balance_owed: formatUsd(balance),
    settled: balance === 0,
    rent_invoice: invoice
      ? { status: invoice.status === "sent" ? "sent, waiting for payment" : invoice.status, total: formatUsd(invoice.totalCents), paypal_invoice_id: invoice.paypalInvoiceId, pay_link: invoice.payerUrl }
      : "no PayPal invoice for this month (recorded directly on the ledger)",
    lines: monthEntries.map((e) => ({
      name: e.description,
      amount: formatUsd(e.amountCents),
      kind: e.kind === "payout" ? "landlord paid the tenant back via PayPal Payouts" : e.kind,
      claim: claimFor(e.claimId),
    })),
    months_on_ledger: months.map(formatPeriod),
    link: `/ledger/${month}?lease=${lease.id}`,
    all_months_link: `/ledger/history?lease=${lease.id}`,
  };
}

const STOPWORDS = new Set(["the", "and", "claim", "repair", "for", "with", "that", "this", "what", "about"]);
const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 2 && !STOPWORDS.has(w)) ?? []);

/** Find a claim on the lease by id or by the words someone used for it. */
export async function resolveClaim(lease: Lease, ref: string) {
  const claims = await db().select().from(schema.claims).where(eq(schema.claims.leaseId, lease.id)).orderBy(desc(schema.claims.createdAt));
  return claims.find((c) => c.id === ref) ?? bestMatch(claims, ref);
}

/** The claim sharing the most words with what the person said (title counts double), if any. */
function bestMatch(claims: Claim[], ref: string): Claim | undefined {
  const wanted = words(ref);
  let best: Claim | undefined;
  let bestScore = 0;
  for (const c of claims) {
    const title = words(c.title);
    const description = words(c.description);
    const score = [...wanted].reduce((sum, w) => sum + (title.has(w) ? 2 : description.has(w) ? 1 : 0), 0);
    if (score > bestScore) [best, bestScore] = [c, score];
  }
  return best;
}

/** All repair claims on the lease, newest first. */
export async function listClaims(lease: Lease) {
  const claims = await db().select().from(schema.claims).where(eq(schema.claims.leaseId, lease.id)).orderBy(desc(schema.claims.createdAt));
  return { claims: claims.map((c) => ({ ...claimSummary(lease, c), claim_id: c.id })), all_claims_link: `/claims?lease=${lease.id}` };
}

/** One claim in detail: what happened, where it stands, Aunt Tally's review, and what's next. */
export async function explainClaim(lease: Lease, role: Role, ref: string) {
  const claims = await db().select().from(schema.claims).where(eq(schema.claims.leaseId, lease.id)).orderBy(desc(schema.claims.createdAt));
  const c = claims.find((x) => x.id === ref) ?? bestMatch(claims, ref);
  if (!c) return { error: `No claim matching "${ref}" on this lease.`, claims: claims.map((x) => x.title) };

  const [events, [payout]] = await Promise.all([
    db().select().from(schema.events).where(eq(schema.events.claimId, c.id)).orderBy(desc(schema.events.createdAt)),
    db().select().from(schema.payouts).where(eq(schema.payouts.claimId, c.id)),
  ]);
  const reviews = events.filter((e) => e.type === "agent.review_started").length;
  const evidenceRequest = c.status === "needs_evidence" ? events.find((e) => e.type === "agent.request_more_evidence") : undefined;
  const checks = events
    .filter((e) => ["agent.check_math", "agent.check_dates", "agent.check_duplicate", "agent.assess_photos"].includes(e.type))
    .slice(0, 4)
    .map((e) => (e.data as { result?: { status?: string; summary?: string } }).result)
    .filter(Boolean)
    .map((r) => `${r!.status}: ${r!.summary}`);
  const myApproval = role === "landlord" ? c.landlordApprovedAt : c.tenantApprovedAt;

  const nextStep =
    c.status === "awaiting_approval"
      ? myApproval ? "You approved; waiting for the other side." : "Your turn: approve the split or propose a different one."
      : c.status === "needs_evidence"
        ? "Make the changes (photos, amount, date), then press Review again, or propose a split yourself."
        : c.status === "approved"
          ? role === "landlord" && c.tenantWantsPayout && c.submittedBy !== lease.landlordId
            ? "The tenant asked to be paid back now: pay it back via PayPal or leave it for the next rent invoice."
            : "Nothing to do; it goes on the next rent invoice."
          : "Nothing to do.";

  return {
    ...claimSummary(lease, c),
    description: c.description.slice(0, 400),
    reported_on: c.issueReportedAt?.toISOString().slice(0, 10) ?? "not given yet",
    agreed_or_proposed_reason: c.splitRationale?.split("\n\nLease:")[0].slice(0, 400) ?? null,
    approvals: { landlord: c.landlordApprovedAt ? "approved" : "not yet", tenant: c.tenantApprovedAt ? "approved" : "not yet" },
    tenant_asked_to_be_paid_back_now: c.tenantWantsPayout,
    payout: payout ? { status: payout.status, amount: formatUsd(payout.amountCents) } : null,
    aunt_tally_reviews: reviews,
    latest_checks: checks,
    evidence_requested: evidenceRequest ? (evidenceRequest.data as { result?: { summary?: string } }).result?.summary : null,
    next_step_for_you: nextStep,
  };
}

export type Todo = { text: string; href: string };

/** What's waiting on this person, most urgent first. */
export async function listTodos(lease: Lease, role: Role): Promise<Todo[]> {
  const [claims, invoices, entries, people] = await Promise.all([
    db().select().from(schema.claims).where(eq(schema.claims.leaseId, lease.id)).orderBy(desc(schema.claims.updatedAt)),
    db().select().from(schema.invoices).where(eq(schema.invoices.leaseId, lease.id)),
    db().select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.leaseId, lease.id)),
    db().select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, [lease.landlordId, lease.tenantId ?? lease.landlordId])),
  ]);
  const first = (id: string | null) => (people.find((p) => p.id === id)?.name ?? "").split(" ")[0] || "the other side";
  const other = role === "landlord" ? first(lease.tenantId) : first(lease.landlordId);
  const requests = claims.length
    ? await db()
        .select({ claimId: schema.events.claimId, data: schema.events.data })
        .from(schema.events)
        .where(and(eq(schema.events.type, "agent.request_more_evidence"), inArray(schema.events.claimId, claims.map((c) => c.id))))
        .orderBy(desc(schema.events.createdAt))
    : [];
  const payouts = claims.length ? await db().select().from(schema.payouts).where(inArray(schema.payouts.claimId, claims.map((c) => c.id))) : [];

  const todos: Todo[] = [];
  const outstanding = invoices.find((i) => i.status === "sent" || i.status === "draft");
  if (outstanding) {
    const label = formatPeriod(outstanding.period);
    todos.push(
      role === "tenant"
        ? { text: `Pay the ${label} rent invoice (${formatUsd(outstanding.totalCents)}), due ${dueDate(lease, outstanding.period)}.`, href: "/ledger" }
        : { text: `${other} hasn't paid the ${label} invoice (${formatUsd(outstanding.totalCents)}) yet. You can send a reminder.`, href: "/ledger" },
    );
  } else if (role === "landlord") {
    const plan = planNextInvoice(lease, entries, claims);
    todos.push({ text: `Send the ${plan.label} rent invoice (${formatUsd(plan.invoice.totalCents)}), due ${dueDate(lease, plan.period)}.`, href: "/ledger" });
  }

  for (const c of claims) {
    const href = `/claims/${c.id}`;
    const myApproval = role === "landlord" ? c.landlordApprovedAt : c.tenantApprovedAt;
    if (c.status === "awaiting_approval" && !myApproval) {
      todos.push({ text: `Approve or counter the split on "${c.title}".`, href });
    } else if (c.status === "needs_evidence") {
      const from = (requests.find((r) => r.claimId === c.id)?.data as { result?: { from?: string } } | undefined)?.result?.from;
      if (from === role) todos.push({ text: `Upload the evidence Aunt Tally asked for on "${c.title}", then ask her to review again.`, href });
      else if (!from && c.submittedBy === (role === "landlord" ? lease.landlordId : lease.tenantId)) {
        todos.push({ text: `Finish your changes on "${c.title}" and ask Aunt Tally to review again.`, href });
      }
    } else if (
      role === "landlord" &&
      c.status === "approved" &&
      c.tenantWantsPayout &&
      c.submittedBy !== lease.landlordId &&
      !payouts.some((p) => p.claimId === c.id)
    ) {
      todos.push({ text: `${other} asked to be paid back now for "${c.title}" (${formatUsd(c.landlordShareCents ?? 0)}). Pay it back or leave it as a rent credit.`, href });
    }
  }
  return todos;
}
