import { eq } from "drizzle-orm";
import Link from "next/link";
import { formatDateTime, todayInAppZone } from "@/lib/time";
import { notFound } from "next/navigation";
import { ActivityList } from "@/app/components/activity-list";
import { Assistant } from "@/app/components/assistant";
import { ClaimStatus } from "@/app/components/claim-status";
import { SubmitButton } from "@/app/components/submit-button";
import { condenseReviews, describeEvent, groupSteps, proposalHistory, type Proposal } from "@/app/components/event-label";
import { WhyTip } from "@/app/components/why-tip";
import { getClaimDetail, getClaimForUser, isDraft, isOpen, REVIEWS_PER_PERSON, reviewsLeft as reviewsLeftFor } from "@/lib/claims";
import { db, schema } from "@/lib/db";
import { formatUsd, parseUsd } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { approve, changePayoutPreference } from "../actions";
import { AddEvidenceForm } from "./add-evidence-form";
import { PayBackButton, PayoutWatcher } from "./pay-back";
import { getTour, pulses } from "@/lib/tour";
import { EditAmount } from "./edit-amount";
import { EditDate } from "./edit-date";
import { ReviewAgainButton } from "./review-again";
import { EvidenceGallery } from "./evidence-gallery";
import { ReviewRunner } from "./review-runner";
import { SplitForm } from "./split-form";
import { UnreviewedChanges } from "./unreviewed-changes";
import { WithdrawButton } from "./withdraw-button";
import { AuntTallyAvatar } from "@/app/components/aunt-tally";
import { ASSISTANT } from "@/lib/persona";

const KIND_LABELS = { receipt: "Receipt", before: "Before", after: "After" } as const;

export default async function ClaimPage({ params }: PageProps<"/claims/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const found = await getClaimForUser(id, user.id);
  if (!found) notFound();
  const { claim, lease, role } = found;
  const [{ evidence: allEvidence, events, names }, [payout], tour, left] = await Promise.all([
    getClaimDetail(claim.id),
    db().select().from(schema.payouts).where(eq(schema.payouts.claimId, claim.id)),
    getTour(user),
    reviewsLeftFor(claim.id),
  ]);
  const evidence = allEvidence.filter((e) => !e.removedAt);
  const draft = isDraft(claim);
  const mine = claim.submittedBy === user.id;
  const firstName = (id: string | null) => (names.get(id ?? "") ?? "").split(" ")[0];
  const people = { landlord: firstName(lease.landlordId) || "The landlord", tenant: firstName(lease.tenantId) || "The tenant" };
  const otherName = role === "landlord" ? people.tenant : people.landlord;
  // On your own draft, approving or proposing also sends the claim to the other side.
  const sendTo = draft && mine ? otherName : null;
  // The trial checklist points at this claim's Approve button when approving it is the next step.
  const approvePulses = pulses(tour, "approve") && tour?.next?.href === `/claims/${claim.id}`;
  // Next step happens on the ledger (send the invoice, pay it): light the way back there.
  const backPulses = pulses(tour, "send_invoice") || pulses(tour, "pay");

  const submitter = names.get(claim.submittedBy) ?? "Unknown";
  const tenantPaid = claim.submittedBy !== lease.landlordId;
  const myApproval = role === "landlord" ? claim.landlordApprovedAt : claim.tenantApprovedAt;
  const open = isOpen(claim);

  // The latest AI review: agent events since the most recent "review_started" (events are newest first).
  const lastStart = events.findIndex((e) => e.type === "agent.review_started");
  const review = lastStart === -1 ? [] : events.slice(0, lastStart).filter((e) => e.actor === "agent").reverse();
  const evidenceRequest = claim.status === "needs_evidence" ? review.findLast((e) => e.type === "agent.request_more_evidence") : undefined;
  const reviewsDone = events.filter((e) => e.type === "agent.review_started").length;
  const myReviewsLeft = left[role];
  // Changes made after the latest AI review finished: the review didn't see them.
  const lastReviewEnd = events.find((e) => e.type === "agent.review_finished")?.createdAt;
  const since = (at: Date | null | undefined) => !!lastReviewEnd && !!at && at > lastReviewEnd && claim.status !== "reviewing";
  const changesSinceReview = events.filter((e) => CHANGE_TYPES.has(e.type) && since(e.createdAt)).reverse();
  const photosAdded = allEvidence.filter((e) => since(e.createdAt) && !e.removedAt).map((e) => ({ id: e.id, kind: e.kind, uploadedBy: e.uploadedBy, at: e.createdAt }));
  const photosRemoved = allEvidence.filter((e) => since(e.removedAt) && !since(e.createdAt)).map((e) => ({ id: e.id, kind: e.kind, uploadedBy: e.uploadedBy, at: e.removedAt! }));
  const unreviewed = changesSinceReview.some((e) => e.type === "claim.amount_changed" || e.type === "claim.date_changed") || photosAdded.length > 0 || photosRemoved.length > 0;
  // The receipt total the AI last read, offered to the submitter as a one-click correction.
  const lastReceipt = events.find((e) => e.type === "agent.record_receipt");
  const receiptTotal = (lastReceipt?.data as { input?: { total?: string } } | undefined)?.input?.total;
  const receiptTotalCents = receiptTotal ? parseUsd(receiptTotal) : null;
  const latestProposal = events.find((e) => e.type === "split.proposed" || e.type === "agent.propose_split");

  return (
    <div className="space-y-8">
      <Assistant leaseId={lease.id} role={role} firstName={user.name.split(" ")[0]} pulse={pulses(tour, "aunt_claim")} />
      {/* A block wrapper so the page's spacing applies (an inline link ignores it), and the same
          padding glowing or not, so the tour's ring never shifts into the card below. */}
      <div>
        <Link
          href={`/ledger?lease=${lease.id}`}
          className={`-ml-2 inline-block rounded-full px-2 py-1 text-sm text-stone-600 hover:text-stone-900 ${backPulses ? "tour-pulse" : ""}`}
        >
          ← {lease.propertyName} ledger
        </Link>
      </div>

      {draft && (
        <p className="rounded-2xl bg-stone-100 px-4 py-3 text-sm text-stone-700">
          <span className="font-semibold text-stone-900">Draft · only you can see this.</span> {otherName} sees it, with its whole history, once you
          approve the split or propose your own.
        </p>
      )}

      <section className="rounded-2xl bg-white shadow-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{claim.title}</h1>
            <p className="text-sm text-stone-600">
              Submitted by {submitter} ({tenantPaid ? "tenant" : "landlord"})
              {claim.issueReportedAt && ` · reported ${claim.issueReportedAt.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}`}
            </p>
            {open && claim.submittedBy === user.id && !claim.reviewStartedAt && (
              <EditDate claimId={claim.id} date={claim.issueReportedAt?.toISOString().slice(0, 10) ?? null} max={todayInAppZone()} />
            )}
          </div>
          <div className="text-right">
            <ClaimStatus status={claim.status} draft={draft} />
            <p className="mt-1 text-2xl font-semibold tabular-nums">{claim.amountCents == null ? "—" : formatUsd(claim.amountCents)}</p>
            <p className="text-xs text-stone-500">paid by {submitter}</p>
            {open && claim.submittedBy === user.id && !claim.reviewStartedAt && (
              <EditAmount claimId={claim.id} amountCents={claim.amountCents ?? 0} receiptTotalCents={receiptTotalCents} />
            )}
          </div>
        </div>
        <p className="mt-4 whitespace-pre-line text-stone-800">{claim.description}</p>
      </section>

      <AiReview reviewing={claim.status === "reviewing"} claimId={claim.id} steps={review} reviewNumber={reviewsDone} />

      {lastReviewEnd && unreviewed && (
        <UnreviewedChanges
          claimId={claim.id}
          reviewedAt={lastReviewEnd}
          changes={changesSinceReview}
          added={photosAdded}
          removed={photosRemoved}
          names={names}
          people={people}
          left={left}
          role={role}
          canAskAgain={claim.status === "needs_evidence" || claim.status === "awaiting_approval"}
        />
      )}

      {claim.status === "needs_evidence" && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="flex items-center gap-2 font-semibold text-amber-900">
            {evidenceRequest && <AuntTallyAvatar size={26} />}
            {evidenceRequest
              ? `Aunt Tally needs more evidence from the ${String((evidenceRequest.data as { result?: { from?: string } }).result?.from ?? "submitter")}`
              : "Waiting for changes"}
          </h2>
          {evidenceRequest && <p className="mt-2 whitespace-pre-line text-amber-950">{describeEvent(evidenceRequest.type, evidenceRequest.data)}</p>}
          {myReviewsLeft > 0 ? (
            <>
              <p className="mt-2 text-sm text-amber-800">
                Make all your changes first (photos, amount, date), then press Review again. Can&apos;t provide something? Propose a split under
                &ldquo;Who pays&rdquo;{sendTo ? `, which sends it to ${sendTo}` : " and the other side reviews it"}.
              </p>
              {!unreviewed && <ReviewAgainButton claimId={claim.id} reviewsLeft={myReviewsLeft} />}
            </>
          ) : (
            <p className="mt-2 text-sm text-amber-800">
              You&apos;ve asked {ASSISTANT.name} to look again {REVIEWS_PER_PERSON} times, the most each side can. Propose a split under
              &ldquo;Who pays&rdquo;{sendTo ? `, which sends it to ${sendTo}` : " and the other side reviews it"}.
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Evidence</h2>
        <EvidenceGallery
          claimId={claim.id}
          photos={evidence.map((e) => ({
            removable: open && e.uploadedBy === user.id && !claim.reviewStartedAt,
            // Changes since the review are listed in "Changes Aunt Tally hasn't reviewed" instead.
            isNew: false,
            id: e.id,
            kind: e.kind,
            label: `${KIND_LABELS[e.kind]} · uploaded by ${names.get(e.uploadedBy) ?? "unknown"}`,
            alt: `${KIND_LABELS[e.kind]} photo uploaded by ${names.get(e.uploadedBy) ?? "unknown"}`,
          }))}
        />
        {open && <AddEvidenceForm claimId={claim.id} />}
      </section>

      <section className="rounded-2xl bg-white shadow-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Who pays</h2>
          {claim.landlordShareCents != null && latestProposal && (
            <span className="text-xs text-stone-500">
              {latestProposal.actor === "agent"
                ? "Proposed by Aunt Tally (AI) · both of you need to approve"
                : `Proposed by ${names.get(String((latestProposal.data as { by?: string }).by)) ?? (latestProposal.data as { by?: string }).by}`}
            </span>
          )}
        </div>
        {claim.landlordShareCents == null ? (
          <p className="mt-2 text-sm text-stone-600">No split proposed yet. Either of you can propose one below.</p>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
              <Share label="Landlord pays" cents={claim.landlordShareCents} approvedAt={claim.landlordApprovedAt} />
              <Share label="Tenant pays" cents={claim.tenantShareCents ?? 0} approvedAt={claim.tenantApprovedAt} />
            </dl>
            {claim.splitRationale && <p className="mt-3 rounded-lg bg-stone-50 p-3 text-sm text-stone-700">{claim.splitRationale}</p>}
            {claim.status !== "paid_out" && (
              <p className="mt-3 text-sm text-stone-600">
                {!tenantPaid
                  ? `On approval, ${formatUsd(claim.tenantShareCents ?? 0)} is added to the tenant's next rent invoice.`
                  : claim.tenantWantsPayout
                    ? `On approval, ${(names.get(lease.landlordId) ?? "the landlord").split(" ")[0]} either pays ${formatUsd(claim.landlordShareCents)} back via PayPal or credits it on the tenant's next rent invoice.`
                    : `On approval, ${formatUsd(claim.landlordShareCents)} is credited on the tenant's next rent invoice.`}
              </p>
            )}
          </>
        )}
        <PayBack
          claimId={claim.id}
          status={claim.status}
          canPayNow={tenantPaid && (claim.landlordShareCents ?? 0) > 0 && payout?.status !== "failed"}
          role={role}
          amountCents={claim.landlordShareCents ?? 0}
          tenantName={names.get(lease.tenantId ?? "") ?? "the tenant"}
          landlordName={names.get(lease.landlordId) ?? "The landlord"}
          payout={payout}
          tenantWantsPayout={claim.tenantWantsPayout}
          canChangePreference={role === "tenant" && claim.submittedBy === user.id && open}
        />

        {claim.status === "awaiting_approval" && !myApproval && role === "landlord" && tenantPaid && claim.tenantWantsPayout && (
          <p className="mt-4 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
            {(names.get(lease.tenantId ?? "") ?? "The tenant").split(" ")[0]} asked to be paid back right away via PayPal. After you
            approve, you choose: pay it back now, or credit it on the next rent invoice. {PAYOUT_FEE_NOTE}
          </p>
        )}
        {claim.status === "awaiting_approval" && !myApproval && (
          <form action={approve} className="mt-4 space-y-3">
            <input type="hidden" name="claimId" value={claim.id} />
            {unreviewed && (
              <label className="flex items-start gap-2 text-sm text-amber-900">
                <input type="checkbox" name="checkedChanges" required className="mt-0.5" />
                I&apos;ve looked at the changes {ASSISTANT.name} hasn&apos;t reviewed.
              </label>
            )}
            <SubmitButton
              pendingLabel="Approving…"
              className={`rounded-full bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 ${approvePulses ? "tour-pulse" : ""}`}
            >
              {sendTo ? `Approve and send to ${sendTo}` : "Approve this split"}
            </SubmitButton>
          </form>
        )}
        {claim.status === "awaiting_approval" && myApproval && (
          <p className="mt-4 text-sm text-stone-600">You approved. Waiting for the {role === "landlord" ? "tenant" : "landlord"}.</p>
        )}
        {open && <SplitForm claimId={claim.id} hasProposal={claim.landlordShareCents != null} sendTo={sendTo} />}
        {/* Without a current split (e.g. after the amount changed), every past proposal is history. */}
        <EarlierProposals proposals={claim.landlordShareCents == null ? proposalHistory(events) : proposalHistory(events).slice(0, -1)} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Claim history</h2>
        <ActivityList events={condenseReviews(events)} />
      </section>

      {open && mine && <WithdrawButton claimId={claim.id} draft={draft} />}
    </div>
  );
}

function Share({ label, cents, approvedAt }: { label: string; cents: number; approvedAt: Date | null }) {
  return (
    <div className="rounded-lg bg-stone-50 p-3">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{formatUsd(cents)}</dd>
      <dd className="text-xs text-stone-500">
        {approvedAt ? `✓ Approved ${formatDateTime(approvedAt)}` : "Not approved yet"}
      </dd>
    </div>
  );
}

const STEP_LABELS: Record<string, string> = {
  "agent.record_receipt": "Read the receipt",
  "agent.check_math": "Amounts add up",
  "agent.check_dates": "Dates make sense",
  "agent.check_duplicate": "Not claimed before",
  "agent.assess_photos": "Photos match the work",
  "agent.estimate_price": "Price vs. local estimate",
  "agent.request_more_evidence": "Asked for more evidence",
  "agent.propose_split": "Proposed a split",
};

const STATUS_STYLE: Record<string, { icon: string; className: string }> = {
  pass: { icon: "✓", className: "bg-emerald-100 text-emerald-800" },
  warn: { icon: "!", className: "bg-amber-100 text-amber-800" },
  fail: { icon: "✕", className: "bg-red-100 text-red-800" },
};

type Step = { id: string; type: string; data: unknown };

const CHANGE_TYPES = new Set(["evidence.added", "evidence.removed", "claim.amount_changed", "claim.date_changed"]);

function AiReview({ reviewing, claimId, steps, reviewNumber }: { reviewing: boolean; claimId: string; steps: Step[]; reviewNumber: number }) {
  if (!reviewing && steps.length === 0) return null;
  const shown = steps.filter((s) => STEP_LABELS[s.type]);
  const notes = steps.filter((s) => !STEP_LABELS[s.type] && s.type !== "agent.review_started" && s.type !== "agent.review_finished");

  return (
    <section className="rounded-2xl bg-white shadow-card ring-1 ring-sky-100 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          {ASSISTANT.name}&apos;s review
          {reviewNumber > 1 && <span className="ml-2 text-sm font-normal text-stone-500">Review {reviewNumber}</span>}
        </h2>
        <span className="text-xs text-stone-500">{ASSISTANT.disclosure} · her checks are hints, not verdicts</span>
      </div>
      {reviewing && (
        <div className="mt-3">
          <ReviewRunner claimId={claimId} />
        </div>
      )}
      <ol className="mt-3 space-y-2">
        {groupSteps(shown).map((row) => {
          const style = STATUS_STYLE[row.status];
          // A passed check needs only its title; its details move into the ? tip. The proposal is
          // the outcome itself, so it always shows.
          const quiet = row.status === "pass" && row.type !== "agent.propose_split";
          const tip = quiet ? [...row.summaries, ...row.whys] : row.whys;
          return (
            <li key={row.id} className="flex gap-3 text-sm">
              <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold ${style.className}`} aria-label={row.status}>
                {style.icon}
              </span>
              <div>
                <p className="flex items-center gap-1.5 font-medium text-stone-900">
                  {STEP_LABELS[row.type]}
                  {tip.length > 0 && <WhyTip why={tip} />}
                </p>
                {!quiet &&
                  row.type !== "agent.request_more_evidence" &&
                  row.summaries.map((summary) => (
                    <p key={summary} className="text-stone-700">
                      {summary}
                    </p>
                  ))}
              </div>
            </li>
          );
        })}
      </ol>
      {notes.map((n) => (
        <p key={n.id} className="mt-3 text-sm text-stone-600">
          {describeEvent(n.type, n.data)}
        </p>
      ))}
    </section>
  );
}

function EarlierProposals({ proposals }: { proposals: Proposal[] }) {
  if (proposals.length === 0) return null;
  const when = formatDateTime;
  return (
    <details className="mt-4 border-t border-stone-100 pt-3 text-sm">
      <summary className="cursor-pointer text-stone-600">Earlier proposals ({proposals.length})</summary>
      <ol className="mt-3 space-y-3">
        {[...proposals].reverse().map((p) => (
          <li key={p.id} className="rounded-lg bg-stone-50 p-3 text-stone-700">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-stone-900">
                Landlord {formatUsd(p.landlordShareCents)} · Tenant {formatUsd(p.tenantShareCents)}
              </span>
              <span className="text-xs text-stone-500">No longer current</span>
            </div>
            <p className="text-xs text-stone-500">
              Proposed by {p.by} · {when(p.at)}
              {p.approvals.map((a) => ` · approved by ${a.by} ${when(a.at)}`).join("")}
            </p>
            {p.rationale && <p className="mt-2 whitespace-pre-line">{p.rationale}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}

const PAYOUT_FEE_NOTE =
  "Paying back via PayPal costs you a PayPal payout fee, shown in your PayPal activity. A credit on the rent invoice adds no extra fee.";

function PayBack({
  claimId,
  status,
  canPayNow,
  role,
  amountCents,
  tenantName,
  landlordName,
  payout,
  tenantWantsPayout,
  canChangePreference,
}: {
  claimId: string;
  status: string;
  canPayNow: boolean;
  role: "landlord" | "tenant";
  amountCents: number;
  tenantName: string;
  landlordName: string;
  payout: typeof schema.payouts.$inferSelect | undefined;
  tenantWantsPayout: boolean;
  canChangePreference: boolean;
}) {
  const firstName = (name: string) => name.split(" ")[0];
  if (status === "paid_out" && payout) {
    return payout.status === "succeeded" ? (
      <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
        <p>
          ✓ {landlordName} paid {formatUsd(payout.amountCents)} back to {tenantName} via PayPal on {formatDateTime(payout.updatedAt)}. It
          isn&apos;t added to a rent invoice.
        </p>
        <p className="mt-1 text-emerald-700">
          {role === "tenant"
            ? "It may take a few minutes to show up in your PayPal account."
            : `The money left your PayPal account right away; it may take a few minutes to show up in ${firstName(tenantName)}'s.`}
        </p>
      </div>
    ) : (
      <p className="mt-4 rounded-lg bg-sky-50 p-3 text-sm text-sky-800">
        <PayoutWatcher claimId={claimId} />
        PayPal is sending {formatUsd(payout.amountCents)} to {tenantName}… ({payout.paypalStatus ?? "starting"})
      </p>
    );
  }
  if (status === "invoiced" || status === "settled") {
    return tenantWantsPayout ? (
      <p className="mt-4 text-sm text-stone-600">
        {firstName(tenantName)} asked to be paid back right away; {firstName(landlordName)} chose to credit it on the rent invoice instead.
      </p>
    ) : null;
  }

  const preference = canChangePreference ? (
    <form action={changePayoutPreference} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="wantsPayout" value={String(!tenantWantsPayout)} />
      <span className="text-stone-600">
        {tenantWantsPayout ? "You asked to be paid back right away via PayPal." : "You'll be credited on the next rent invoice."}
      </span>
      <SubmitButton className="rounded-full border border-stone-300 bg-white px-3 py-1.5 font-medium text-stone-800 shadow-sm hover:border-stone-500 hover:bg-stone-50 disabled:opacity-50">
        {tenantWantsPayout ? "A rent credit is fine" : "Ask to be paid back now instead"}
      </SubmitButton>
    </form>
  ) : null;

  if (status !== "approved") return preference;
  if (payout?.status === "failed") {
    return <p className="mt-4 text-sm text-stone-600">A PayPal payout didn&apos;t go through, so this will be credited on the next rent invoice.</p>;
  }
  if (!canPayNow) return preference;
  return role === "landlord" ? (
    <div className={`mt-4 rounded-lg border p-3 text-sm ${tenantWantsPayout ? "border-sky-300 bg-sky-50" : "border-stone-200"}`}>
      {tenantWantsPayout && <p className="mb-1 font-medium text-sky-900">{firstName(tenantName)} asked to be paid back right away via PayPal.</p>}
      <p className="text-stone-700">
        {tenantWantsPayout
          ? `You decide: pay ${formatUsd(amountCents)} back now, or leave it as a credit on the next rent invoice.`
          : `Don't want ${firstName(tenantName)} to wait for next month? Pay ${formatUsd(amountCents)} back now instead of crediting the rent.`}
      </p>
      <p className="mt-1 text-stone-500">{PAYOUT_FEE_NOTE}</p>
      <PayBackButton claimId={claimId} amount={formatUsd(amountCents)} tenantName={firstName(tenantName)} />
    </div>
  ) : (
    <div className="mt-4 text-sm text-stone-600">
      <p>
        {tenantWantsPayout
          ? `You asked to be paid back right away via PayPal. ${firstName(landlordName)} decides whether to pay it back now or credit it on next month's rent.`
          : `${landlordName} can pay this back to your PayPal right away instead of crediting next month's rent.`}
      </p>
    </div>
  );
}
