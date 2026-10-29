import { and, eq } from "drizzle-orm";
import { resolveClaim } from "@/lib/assistant/context";
import { runToolkitTool } from "@/lib/assistant/paypal-toolkit";
import {
  addEvidence,
  approveClaim,
  createClaim,
  isOpen,
  MAX_REVIEWS,
  proposeSplit,
  requestReview,
  reviewCount,
  setPayoutPreference,
  updateClaimAmount,
  withdrawClaim,
} from "@/lib/claims";
import { db, schema } from "@/lib/db";
import { issueNextInvoice } from "@/lib/invoicing";
import { planNextInvoice } from "@/lib/ledger";
import { formatUsd, parseUsd, splitByShare } from "@/lib/money";
import { payClaimNow } from "@/lib/payouts";
import { ASSISTANT } from "@/lib/persona";
import { formatPeriod } from "@/lib/period";
import { NOTIFY_LABEL, NOTIFY_LEVELS, setNotifyLevel, type NotifyLevel } from "@/lib/notifications";
import type { User as SessionUser } from "@/lib/session";
import type { EvidenceKind } from "@/lib/storage";
import { payableInvoice, payInvoiceWithVault } from "@/lib/vault";
import { runVia } from "@/lib/via";

// Things Aunt Tally can do for someone. Each happens in two steps:
//  1. prepareAction (called from her chat tools) checks the action makes sense right now and returns a
//     confirmation card; nothing changes.
//  2. performAction (called when the person presses Confirm) runs it through the same lib code as the
//     regular pages, which re-checks permissions and state, and tags the events "via Aunt Tally".

type Lease = typeof schema.leases.$inferSelect;
type Role = "landlord" | "tenant";
type User = { id: string; name: string };

export type Action =
  | { kind: "create_claim"; title: string; description: string; issueDate: string | null; amount: string | null; wantsPayout: boolean }
  | { kind: "add_evidence"; claimId: string }
  | { kind: "approve_split"; claimId: string }
  | { kind: "propose_split"; claimId: string; landlordPercent: number; rationale: string }
  | { kind: "withdraw_claim"; claimId: string }
  | { kind: "change_amount"; claimId: string; amount: string }
  | { kind: "set_payout_preference"; claimId: string; wantsPayout: boolean }
  | { kind: "request_review"; claimId: string }
  | { kind: "pay_back_now"; claimId: string }
  | { kind: "send_next_invoice" }
  | { kind: "send_reminder"; invoiceId: string; note: string }
  | { kind: "pay_invoice"; invoiceId: string }
  | { kind: "set_notifications"; level: NotifyLevel };

/** What the confirmation card shows. `needsPhotos` asks the chat to send the photos attached in it. */
export type Pending = { action: Action; title: string; lines: string[]; confirmLabel: string; needsPhotos?: boolean };

export type Attachment = { kind: EvidenceKind; name: string };

/** Check an action against the current state and describe it for the card, or explain why not. */
export async function prepareAction(
  lease: Lease,
  role: Role,
  userId: string,
  kind: Action["kind"],
  input: Record<string, unknown>,
  attachments: Attachment[],
): Promise<Pending | { error: string }> {
  const photoLine = attachments.length ? `Photos: ${attachments.map((a) => `${a.kind} (${a.name})`).join(", ")}` : "Photos: None";

  if (kind === "create_claim") {
    const title = String(input.title ?? "").trim();
    const amount = String(input.amount ?? "").replace(/[$,\s]/g, "");
    if (title.length < 3) return { error: "Ask what was repaired (a short title)." };
    // Amount and date are optional: the review reads them off the receipt.
    let cents: number | null = null;
    if (amount) {
      try {
        cents = parseUsd(amount);
      } catch {
        return { error: "The amount isn't a dollar figure; leave it out and the review reads it from the receipt." };
      }
      if (cents <= 0) return { error: "The receipt total must be more than $0." };
    }
    if (cents == null && !attachments.some((a) => a.kind === "receipt")) return { error: "Ask for a photo of the receipt (paperclip button); the review reads the total from it." };
    const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.issue_date)) ? String(input.issue_date) : null;
    const description = String(input.description ?? "").trim() || title;
    const wantsPayout = role === "tenant" && input.wants_payout === true;
    return {
      action: { kind, title, description, issueDate, amount: cents == null ? null : (cents / 100).toFixed(2), wantsPayout },
      title: `Submit the claim "${title}"?`,
      lines: [
        `What happened: ${description}`,
        `Amount: ${cents == null ? "Read from the receipt" : formatUsd(cents)}`,
        ...(issueDate ? [`Reported: ${issueDate}`] : []),
        photoLine,
        ...(role === "tenant" ? [`Payback: ${wantsPayout ? "Right away via PayPal" : "Credit on your next rent"}`] : []),
        "I'll review it as soon as it's submitted.",
      ],
      confirmLabel: "Submit claim",
      needsPhotos: attachments.length > 0,
    };
  }

  if (kind === "send_next_invoice") {
    if (role !== "landlord") return { error: "Only the landlord sends rent invoices." };
    const [entries, claims, invoices] = await Promise.all([
      db().select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.leaseId, lease.id)),
      db().select().from(schema.claims).where(eq(schema.claims.leaseId, lease.id)),
      db().select().from(schema.invoices).where(eq(schema.invoices.leaseId, lease.id)),
    ]);
    const outstanding = invoices.find((i) => i.status === "sent" || i.status === "draft");
    if (outstanding) return { error: `The ${formatPeriod(outstanding.period)} invoice hasn't been paid yet, so the next one can't go out.` };
    const plan = planNextInvoice(lease, entries, claims);
    return {
      action: { kind },
      title: `Send the ${plan.label} rent invoice through PayPal?`,
      lines: [...plan.invoice.lines.map((l) => `${l.name}: ${formatUsd(l.amountCents)}`), `Total: ${formatUsd(plan.invoice.totalCents)}`],
      confirmLabel: "Send invoice",
    };
  }

  if (kind === "set_notifications") {
    const level = String(input.level ?? "") as NotifyLevel;
    if (!NOTIFY_LEVELS.includes(level)) return { error: `level must be one of ${NOTIFY_LEVELS.join(", ")}` };
    return {
      action: { kind, level },
      title: `Notify you about: ${NOTIFY_LABEL[level].toLowerCase()}?`,
      lines: [level === "off" ? "The bell stays quiet; the activity log still has everything." : "They show up under the bell at the top of the page."],
      confirmLabel: "Save",
    };
  }

  if (kind === "pay_invoice") {
    if (role !== "tenant") return { error: "Only the tenant pays rent invoices." };
    const invoice = await payableInvoice(lease);
    if (!invoice) return { error: "There's no rent invoice waiting for payment right now." };
    const [me] = await db().select().from(schema.users).where(eq(schema.users.id, userId));
    if (!me?.paypalVaultId) {
      return { error: `They haven't saved a PayPal yet. Tell them to press "Save my PayPal for rent" on the [ledger](/ledger) first, or pay with the invoice's Pay with PayPal button.` };
    }
    return {
      action: { kind, invoiceId: invoice.id },
      title: `Pay the ${formatPeriod(invoice.period)} rent invoice, ${formatUsd(invoice.totalCents)}?`,
      lines: [`From your saved PayPal${me.paypalVaultEmail ? ` (${me.paypalVaultEmail})` : ""}`, "PayPal emails you a receipt."],
      confirmLabel: `Pay ${formatUsd(invoice.totalCents)}`,
    };
  }

  if (kind === "send_reminder") {
    if (role !== "landlord") return { error: "Only the landlord can send reminders." };
    const [invoice] = await db()
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.leaseId, lease.id), eq(schema.invoices.paypalInvoiceId, String(input.paypal_invoice_id ?? ""))));
    if (!invoice || invoice.status !== "sent") return { error: "Reminders are only for an unpaid invoice that was sent on this lease." };
    const note = String(input.note ?? "").slice(0, 200);
    return {
      action: { kind, invoiceId: invoice.id, note },
      title: `Send a PayPal reminder for the ${formatPeriod(invoice.period)} invoice (${formatUsd(invoice.totalCents)})?`,
      lines: [`"${note}"`],
      confirmLabel: "Send reminder",
    };
  }

  // Everything else is about one claim.
  const claim = await resolveClaim(lease, String(input.claim ?? ""));
  if (!claim) return { error: `No claim matching "${input.claim}" on this lease.` };
  const mine = claim.submittedBy === userId;
  const tenantFronted = claim.submittedBy !== lease.landlordId;
  const name = `"${claim.title}"`;

  switch (kind) {
    case "add_evidence":
      if (!isOpen(claim)) return { error: `${name} is closed, so photos can't be added.` };
      if (!attachments.length) return { error: "Ask them to attach the photos in the chat first (the paperclip button)." };
      return { action: { kind, claimId: claim.id }, title: `Add these photos to ${name}?`, lines: [photoLine], confirmLabel: "Add photos", needsPhotos: true };

    case "approve_split": {
      const approved = role === "landlord" ? claim.landlordApprovedAt : claim.tenantApprovedAt;
      if (claim.status !== "awaiting_approval") return { error: `${name} has no split waiting for approval.` };
      if (approved) return { error: "They already approved this split." };
      return {
        action: { kind, claimId: claim.id },
        title: `Approve the split on ${name}?`,
        lines: [`Landlord bears ${formatUsd(claim.landlordShareCents ?? 0)}, tenant bears ${formatUsd(claim.tenantShareCents ?? 0)}`],
        confirmLabel: "Approve split",
      };
    }

    case "propose_split": {
      if (!isOpen(claim)) return { error: `${name} is closed.` };
      const percent = Number(input.landlord_percent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return { error: "The landlord's share must be 0–100%." };
      const rationale = String(input.rationale ?? "").trim();
      if (rationale.length < 5) return { error: "Ask why this split is fair, in a sentence." };
      const { landlord, tenant } = splitByShare(claim.amountCents ?? 0, Math.round(percent * 100));
      return {
        action: { kind, claimId: claim.id, landlordPercent: percent, rationale },
        title: `Propose a new split on ${name}?`,
        lines: [`Landlord bears ${formatUsd(landlord)}, tenant bears ${formatUsd(tenant)}`, `Why: ${rationale}`, "Proposing counts as your approval; the other side then approves or counters."],
        confirmLabel: "Propose split",
      };
    }

    case "withdraw_claim":
      if (!mine) return { error: "Only the person who submitted a claim can withdraw it." };
      if (!isOpen(claim)) return { error: `${name} is already closed.` };
      return { action: { kind, claimId: claim.id }, title: `Withdraw ${name}?`, lines: ["This closes it for both of you and can't be undone."], confirmLabel: "Withdraw claim" };

    case "change_amount": {
      if (!mine) return { error: "Only the person who submitted a claim can change its amount." };
      if (!isOpen(claim)) return { error: `${name} is closed.` };
      let cents: number;
      try {
        cents = parseUsd(String(input.amount ?? "").replace(/[$,\s]/g, ""));
      } catch {
        return { error: "Ask for the new amount in dollars." };
      }
      return {
        action: { kind, claimId: claim.id, amount: (cents / 100).toFixed(2) },
        title: `Change the amount on ${name}?`,
        lines: [`From ${formatUsd(claim.amountCents ?? 0)} to ${formatUsd(cents)}`, "Any proposed split is cleared; ask for a new review when you're done."],
        confirmLabel: "Change amount",
      };
    }

    case "set_payout_preference": {
      if (!mine || role !== "tenant") return { error: "Only the tenant who submitted the claim can change this." };
      if (!isOpen(claim)) return { error: "Both sides already approved, so the payback preference is fixed." };
      const wantsPayout = input.wants_payout === true;
      return {
        action: { kind, claimId: claim.id, wantsPayout },
        title: wantsPayout ? `Ask to be paid back right away on ${name}?` : `Take a rent credit on ${name}?`,
        lines: [wantsPayout ? "The landlord still decides whether to pay it back now." : "Your share comes off the next rent invoice."],
        confirmLabel: "Save preference",
      };
    }

    case "request_review": {
      if (claim.status !== "needs_evidence" && claim.status !== "awaiting_approval") return { error: `${name} isn't waiting for a new review.` };
      const left = MAX_REVIEWS - (await reviewCount(claim.id));
      if (left <= 0) return { error: `${ASSISTANT.name} already reviewed ${name} ${MAX_REVIEWS} times. Either side can propose a split instead.` };
      return { action: { kind, claimId: claim.id }, title: `Ask ${ASSISTANT.name} to review ${name} again?`, lines: [left === 1 ? "This is the last review." : `${left} reviews left.`], confirmLabel: "Start review" };
    }

    case "pay_back_now":
      if (role !== "landlord") return { error: "Only the landlord can pay a claim back." };
      if (claim.status !== "approved" || !tenantFronted || !claim.landlordShareCents) return { error: `${name} isn't an approved claim the landlord owes money on.` };
      return {
        action: { kind, claimId: claim.id },
        title: `Pay ${formatUsd(claim.landlordShareCents)} back now for ${name}?`,
        lines: ["Sent to the tenant's PayPal now instead of crediting the next rent invoice.", "PayPal charges you a payout fee, shown in your PayPal activity."],
        confirmLabel: "Pay back via PayPal",
      };
  }
  return { error: `Unknown action ${kind}` };
}

/** The person pressed Confirm. Runs the action and says what happened. */
export async function performAction(
  user: SessionUser,
  lease: Lease,
  action: Action,
  photos: { kind: EvidenceKind; file: File }[],
): Promise<{ message: string; claimId?: string; startReview?: boolean }> {
  return runVia(`${ASSISTANT.name} chat`, async () => {
    switch (action.kind) {
      case "create_claim": {
        const claimId = await createClaim(user, {
          leaseId: lease.id,
          title: action.title,
          description: action.description,
          issueReportedAt: action.issueDate ? new Date(`${action.issueDate}T12:00:00Z`) : null,
          amountCents: action.amount ? parseUsd(action.amount) : null,
          tenantWantsPayout: action.wantsPayout,
          files: photos,
        });
        return { message: `Submitted "${action.title}".`, claimId, startReview: true };
      }
      case "add_evidence":
        await addEvidence(user, action.claimId, photos);
        return { message: "Photos added.", claimId: action.claimId };
      case "approve_split":
        await approveClaim(user, action.claimId);
        return { message: "Approved.", claimId: action.claimId };
      case "propose_split":
        await proposeSplit(user, action.claimId, Math.round(action.landlordPercent * 100), action.rationale);
        return { message: "Proposed. The other side can approve or counter it.", claimId: action.claimId };
      case "withdraw_claim":
        await withdrawClaim(user, action.claimId);
        return { message: "Withdrawn.", claimId: action.claimId };
      case "change_amount":
        await updateClaimAmount(user, action.claimId, parseUsd(action.amount));
        return { message: "Amount changed.", claimId: action.claimId };
      case "set_payout_preference":
        await setPayoutPreference(user, action.claimId, action.wantsPayout);
        return { message: "Saved.", claimId: action.claimId };
      case "request_review":
        await requestReview(user, action.claimId);
        return { message: "Review started.", claimId: action.claimId, startReview: true };
      case "pay_back_now":
        await payClaimNow(user, action.claimId);
        return { message: "PayPal is sending the money now.", claimId: action.claimId };
      case "send_next_invoice": {
        const invoice = await issueNextInvoice(user, lease.id);
        return { message: `The ${formatPeriod(invoice.period)} invoice is on its way through PayPal.` };
      }
      case "send_reminder":
        await sendReminder(user, lease, action.invoiceId, action.note);
        return { message: "PayPal sent the reminder." };
      case "set_notifications":
        await setNotifyLevel(user, action.level);
        return { message: `Notifications: ${NOTIFY_LABEL[action.level].toLowerCase()}.` };
      case "pay_invoice": {
        const paid = await payInvoiceWithVault(user, lease, action.invoiceId);
        return { message: `Paid ${formatUsd(paid.paidCents)} for ${paid.period} rent with your saved PayPal.` };
      }
    }
  });
}

/** Send a PayPal reminder through the Agent Toolkit and log it for both sides. */
async function sendReminder(user: User, lease: Lease, invoiceId: string, note: string) {
  if (lease.landlordId !== user.id) throw new Error("Only the landlord can send reminders");
  const [invoice] = await db()
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.id, invoiceId), eq(schema.invoices.leaseId, lease.id)));
  if (!invoice?.paypalInvoiceId || invoice.status !== "sent") throw new Error("That invoice isn't waiting for payment");
  const result = (await runToolkitTool("send_invoice_reminder", {
    invoice_id: invoice.paypalInvoiceId,
    subject: `Reminder: ${formatPeriod(invoice.period)} rent`,
    note: note.slice(0, 200),
  })) as { ok?: boolean; message?: string } | string;
  if (typeof result === "object" && result?.ok === false) throw new Error(result.message ?? "PayPal didn't send the reminder");
  await db().insert(schema.events).values({
    leaseId: lease.id,
    actor: "landlord",
    type: "invoice.reminder_sent",
    data: { by: user.name, period: formatPeriod(invoice.period), note: note.slice(0, 200), via: `${ASSISTANT.name} (PayPal Agent Toolkit)` },
  });
}
