import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { planNextInvoice } from "@/lib/ledger";
import { formatUsd, toApiValue } from "@/lib/money";
import { formatPeriod } from "@/lib/period";

// Facts the assistant can look up about one lease, from our own database. Amounts are returned
// both as display strings and API values so the money guard can recognise them in her reply.

type Lease = typeof schema.leases.$inferSelect;
type Role = "landlord" | "tenant";

const dueDate = (lease: Lease, period: string) => `${period}-${String(lease.dueDay).padStart(2, "0")}`;

/** Line-by-line breakdown of one month's rent invoice, with the claim behind each adjustment. */
export async function explainInvoice(lease: Lease, period?: string) {
  const [invoices, entries, claims] = await Promise.all([
    db().select().from(schema.invoices).where(eq(schema.invoices.leaseId, lease.id)).orderBy(desc(schema.invoices.period)),
    db().select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.leaseId, lease.id)).orderBy(asc(schema.ledgerEntries.createdAt)),
    db().select().from(schema.claims).where(eq(schema.claims.leaseId, lease.id)),
  ]);
  const claimInfo = (claimId: string | null) => {
    const c = claims.find((x) => x.id === claimId);
    if (!c) return null;
    const tenantFronted = c.submittedBy !== lease.landlordId;
    return {
      title: c.title,
      // Who paid the repair bill up front is not who ends up bearing the cost; say both plainly.
      paid_up_front_by: tenantFronted ? "tenant (paid the repair bill and is being reimbursed)" : "landlord (paid the repair bill and is charging the tenant's share)",
      receipt_total: formatUsd(c.amountCents ?? 0),
      agreed_split: `landlord bears ${formatUsd(c.landlordShareCents ?? 0)}, tenant bears ${formatUsd(c.tenantShareCents ?? 0)}`,
      status: c.status === "settled" || c.status === "paid_out" ? "settled (final)" : c.status === "invoiced" ? "on this invoice (agreed, final)" : c.status,
      background: c.splitRationale?.split("\n\nLease:")[0].slice(0, 300) ?? null,
      link: `/claims/${c.id}`,
    };
  };

  const invoice = period ? invoices.find((i) => i.period === period) : invoices[0];
  if (!invoice) {
    // Nothing issued for that month: explain the preview of the next invoice instead.
    const plan = planNextInvoice(lease, entries, claims);
    if (period && period !== plan.period) return { error: `There's no invoice for ${formatPeriod(period)}.` };
    return {
      month: plan.label,
      status: "not sent yet (preview)",
      due_date: dueDate(lease, plan.period),
      total: formatUsd(plan.invoice.totalCents),
      lines: plan.invoice.lines.map((l) => ({ name: l.name, amount: formatUsd(l.amountCents), claim: claimInfo(l.claimId ?? null) })),
      credit_carried_to_next_month: plan.invoice.carryOverCents ? formatUsd(plan.invoice.carryOverCents) : null,
    };
  }

  const lines = entries.filter((e) => e.invoiceId === invoice.id && e.kind !== "payment");
  const payments = entries.filter((e) => e.invoiceId === invoice.id && e.kind === "payment");
  return {
    month: formatPeriod(invoice.period),
    status: invoice.status === "sent" ? "sent, waiting for payment" : invoice.status,
    due_date: dueDate(lease, invoice.period),
    total: formatUsd(invoice.totalCents),
    total_value: toApiValue(invoice.totalCents),
    paid: payments.length ? formatUsd(-payments.reduce((s, p) => s + p.amountCents, 0)) : null,
    paypal_invoice_id: invoice.paypalInvoiceId,
    pay_link: invoice.payerUrl,
    lines: lines.map((l) => ({ name: l.description, amount: formatUsd(l.amountCents), claim: claimInfo(l.claimId) })),
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
