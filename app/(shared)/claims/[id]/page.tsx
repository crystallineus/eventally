import { eq } from "drizzle-orm";
import Link from "next/link";
import { formatDateTime } from "@/lib/time";
import { notFound } from "next/navigation";
import { ClaimStatus } from "@/app/components/claim-status";
import { SubmitButton } from "@/app/components/submit-button";
import { condenseReviews, describeEvent, groupSteps, proposalHistory, type Proposal } from "@/app/components/event-label";
import { WhyTip } from "@/app/components/why-tip";
import { getClaimDetail, getClaimForUser, isOpen, MAX_REVIEWS } from "@/lib/claims";
import { db, schema } from "@/lib/db";
import { formatUsd, parseUsd } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { approve } from "../actions";
import { AddEvidenceForm } from "./add-evidence-form";
import { PayBackButton, PayoutWatcher } from "./pay-back";
import { EditAmount } from "./edit-amount";
import { ReviewAgainButton } from "./review-again";
import { EvidenceGallery } from "./evidence-gallery";
import { ReviewRunner } from "./review-runner";
import { SplitForm } from "./split-form";
import { WithdrawButton } from "./withdraw-button";

const KIND_LABELS = { receipt: "Receipt", before: "Before", after: "After" } as const;

export default async function ClaimPage({ params }: PageProps<"/claims/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const found = await getClaimForUser(id, user.id);
  if (!found) notFound();
  const { claim, lease, role } = found;
  const [{ evidence, events, names }, [payout]] = await Promise.all([
    getClaimDetail(claim.id),
    db().select().from(schema.payouts).where(eq(schema.payouts.claimId, claim.id)),
  ]);

  const submitter = names.get(claim.submittedBy) ?? "Unknown";
  const tenantPaid = claim.submittedBy !== lease.landlordId;
  const myApproval = role === "landlord" ? claim.landlordApprovedAt : claim.tenantApprovedAt;
  const open = isOpen(claim);

  // The latest AI review: agent events since the most recent "review_started" (events are newest first).
  const lastStart = events.findIndex((e) => e.type === "agent.review_started");
  const review = lastStart === -1 ? [] : events.slice(0, lastStart).filter((e) => e.actor === "agent").reverse();
  const evidenceRequest = claim.status === "needs_evidence" ? review.findLast((e) => e.type === "agent.request_more_evidence") : undefined;
  const reviewsDone = events.filter((e) => e.type === "agent.review_started").length;
  const reviewsLeft = Math.max(0, MAX_REVIEWS - reviewsDone);
  // Changes made after the latest AI review finished: the review didn't see them.
  const lastReviewEnd = events.find((e) => e.type === "agent.review_finished")?.createdAt;
  const changesSinceReview =
    lastReviewEnd && claim.status !== "reviewing"
      ? events.filter((e) => CHANGE_TYPES.has(e.type) && e.createdAt > lastReviewEnd).reverse()
      : [];
  // The receipt total the AI last read, offered to the submitter as a one-click correction.
  const lastReceipt = events.find((e) => e.type === "agent.record_receipt");
  const receiptTotal = (lastReceipt?.data as { input?: { total?: string } } | undefined)?.input?.total;
  const receiptTotalCents = receiptTotal ? parseUsd(receiptTotal) : null;
  const latestProposal = events.find((e) => e.type === "split.proposed" || e.type === "agent.propose_split");

  return (
    <div className="space-y-8">
      <Link href={`/ledger?lease=${lease.id}`} className="text-sm text-stone-600 hover:text-stone-900">
        ← {lease.propertyName} ledger
      </Link>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{claim.title}</h1>
            <p className="text-sm text-stone-600">
              Submitted by {submitter} ({tenantPaid ? "tenant" : "landlord"}) · reported{" "}
              {claim.issueReportedAt.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}
            </p>
          </div>
          <div className="text-right">
            <ClaimStatus status={claim.status} />
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatUsd(claim.amountCents ?? 0)}</p>
            <p className="text-xs text-stone-500">paid by {submitter}</p>
            {open && claim.submittedBy === user.id && !claim.reviewStartedAt && (
              <EditAmount claimId={claim.id} amountCents={claim.amountCents ?? 0} receiptTotalCents={receiptTotalCents} />
            )}
          </div>
        </div>
        <p className="mt-4 whitespace-pre-line text-stone-800">{claim.description}</p>
      </section>

      <AiReview reviewing={claim.status === "reviewing"} claimId={claim.id} steps={review} reviewNumber={reviewsDone}>
        {changesSinceReview.length > 0 && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">This review is out of date. Since it ran:</p>
            <ul className="mt-1 list-disc pl-5">
              {changesSinceReview.map((e) => (
                <li key={e.id}>{describeEvent(e.type, e.data)}</li>
              ))}
            </ul>
            {reviewsLeft > 0 ? (
              claim.status === "awaiting_approval" && (
                <>
                  <p className="mt-2">Ask the AI to look again; the current proposal moves to the history.</p>
                  <ReviewAgainButton claimId={claim.id} reviewsLeft={reviewsLeft} />
                </>
              )
            ) : (
              <p className="mt-2">
                The AI has reviewed this claim {MAX_REVIEWS} times, which is the limit, so it won&apos;t check these changes. Before
                approving, look at the new evidence yourself; photos added since the review are marked &ldquo;New&rdquo; below.
              </p>
            )}
          </div>
        )}
      </AiReview>

      {claim.status === "needs_evidence" && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-900">
            {evidenceRequest
              ? `EvenTally AI needs more evidence from the ${String((evidenceRequest.data as { result?: { from?: string } }).result?.from ?? "submitter")}`
              : "Waiting for changes"}
          </h2>
          {evidenceRequest && <p className="mt-2 whitespace-pre-line text-amber-950">{describeEvent(evidenceRequest.type, evidenceRequest.data)}</p>}
          {reviewsLeft > 0 ? (
            <>
              <p className="mt-2 text-sm text-amber-800">
                Make all your changes first (photos, amount), then ask the AI to review again. Can&apos;t provide something?
                Either of you can propose a split under &ldquo;Who pays&rdquo; and the other side reviews it.
              </p>
              <ReviewAgainButton claimId={claim.id} reviewsLeft={reviewsLeft} />
            </>
          ) : (
            <p className="mt-2 text-sm text-amber-800">
              The AI has reviewed this claim {MAX_REVIEWS} times, which is the limit. Propose a split under &ldquo;Who pays&rdquo;
              and the other side reviews it.
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 font-semibold">Evidence</h2>
        <EvidenceGallery
          claimId={claim.id}
          photos={evidence.map((e) => ({
            removable: open && e.uploadedBy === user.id && !claim.reviewStartedAt,
            isNew: !!lastReviewEnd && e.createdAt > lastReviewEnd,
            id: e.id,
            kind: e.kind,
            label: `${KIND_LABELS[e.kind]} · uploaded by ${names.get(e.uploadedBy) ?? "unknown"}`,
            alt: `${KIND_LABELS[e.kind]} photo uploaded by ${names.get(e.uploadedBy) ?? "unknown"}`,
          }))}
        />
        {open && <AddEvidenceForm claimId={claim.id} />}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Who pays</h2>
          {claim.landlordShareCents != null && latestProposal && (
            <span className="text-xs text-stone-500">
              {latestProposal.actor === "agent"
                ? "Proposed by EvenTally AI · both of you need to approve"
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
                {tenantPaid
                  ? `On approval, ${formatUsd(claim.landlordShareCents)} is credited on the tenant's next rent invoice.`
                  : `On approval, ${formatUsd(claim.tenantShareCents ?? 0)} is added to the tenant's next rent invoice.`}
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
        />

        {claim.status === "awaiting_approval" && !myApproval && (
          <form action={approve} className="mt-4">
            <input type="hidden" name="claimId" value={claim.id} />
            <SubmitButton pendingLabel="Approving…" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50">
              Approve this split
            </SubmitButton>
          </form>
        )}
        {claim.status === "awaiting_approval" && myApproval && (
          <p className="mt-4 text-sm text-stone-600">You approved. Waiting for the {role === "landlord" ? "tenant" : "landlord"}.</p>
        )}
        {open && <SplitForm claimId={claim.id} hasProposal={claim.landlordShareCents != null} />}
        {/* Without a current split (e.g. after the amount changed), every past proposal is history. */}
        <EarlierProposals proposals={claim.landlordShareCents == null ? proposalHistory(events) : proposalHistory(events).slice(0, -1)} />
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Claim history</h2>
        <ol className="space-y-2 text-sm">
          {condenseReviews(events).map((e) => (
            <li key={e.id} className="flex gap-3 rounded-lg bg-white px-4 py-2 ring-1 ring-stone-200">
              <time className="shrink-0 font-mono text-xs leading-5 text-stone-500" dateTime={e.createdAt.toISOString()}>
                {formatDateTime(e.createdAt)}
              </time>
              <span className="shrink-0 rounded bg-stone-100 px-1.5 text-xs leading-5 capitalize text-stone-600">{e.actor}</span>
              <span className="text-stone-800">{describeEvent(e.type, e.data)}</span>
            </li>
          ))}
        </ol>
      </section>

      {open && claim.submittedBy === user.id && <WithdrawButton claimId={claim.id} />}
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

const CHANGE_TYPES = new Set(["evidence.added", "evidence.removed", "claim.amount_changed"]);

function AiReview({
  reviewing,
  claimId,
  steps,
  reviewNumber,
  children,
}: {
  reviewing: boolean;
  claimId: string;
  steps: Step[];
  reviewNumber: number;
  children?: React.ReactNode;
}) {
  if (!reviewing && steps.length === 0) return null;
  const shown = steps.filter((s) => STEP_LABELS[s.type]);
  const notes = steps.filter((s) => !STEP_LABELS[s.type] && s.type !== "agent.review_started" && s.type !== "agent.review_finished");

  return (
    <section className="rounded-xl border border-sky-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">
          AI review
          {reviewNumber > 0 && (
            <span className="ml-2 text-sm font-normal text-stone-500">
              Review {Math.min(reviewNumber, MAX_REVIEWS)} of {MAX_REVIEWS}
              {reviewNumber >= MAX_REVIEWS && " · final"}
            </span>
          )}
        </h2>
        <span className="text-xs text-stone-500">EvenTally AI · checks are hints, not verdicts</span>
      </div>
      {children && <div className="mt-3">{children}</div>}
      {reviewing && (
        <div className="mt-3">
          <ReviewRunner claimId={claimId} />
        </div>
      )}
      <ol className="mt-3 space-y-2">
        {groupSteps(shown).map((row) => {
          const style = STATUS_STYLE[row.status];
          return (
            <li key={row.id} className="flex gap-3 text-sm">
              <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold ${style.className}`} aria-label={row.status}>
                {style.icon}
              </span>
              <div>
                <p className="flex items-center gap-1.5 font-medium text-stone-900">
                  {STEP_LABELS[row.type]}
                  {row.whys.length > 0 && <WhyTip why={row.whys} />}
                </p>
                {row.type !== "agent.request_more_evidence" &&
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

function PayBack({
  claimId,
  status,
  canPayNow,
  role,
  amountCents,
  tenantName,
  landlordName,
  payout,
}: {
  claimId: string;
  status: string;
  canPayNow: boolean;
  role: "landlord" | "tenant";
  amountCents: number;
  tenantName: string;
  landlordName: string;
  payout: typeof schema.payouts.$inferSelect | undefined;
}) {
  if (status === "paid_out" && payout) {
    return payout.status === "succeeded" ? (
      <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
        ✓ {landlordName} paid {formatUsd(payout.amountCents)} back to {tenantName} via PayPal on {formatDateTime(payout.updatedAt)}. It
        isn&apos;t added to a rent invoice.
      </p>
    ) : (
      <p className="mt-4 rounded-lg bg-sky-50 p-3 text-sm text-sky-800">
        <PayoutWatcher claimId={claimId} />
        PayPal is sending {formatUsd(payout.amountCents)} to {tenantName}… ({payout.paypalStatus ?? "starting"})
      </p>
    );
  }
  if (status !== "approved") return null;
  if (payout?.status === "failed") {
    return <p className="mt-4 text-sm text-stone-600">A PayPal payout didn&apos;t go through, so this will be credited on the next rent invoice.</p>;
  }
  if (!canPayNow) return null;
  return role === "landlord" ? (
    <div className="mt-4 rounded-lg border border-stone-200 p-3 text-sm">
      <p className="text-stone-700">
        Don&apos;t want {tenantName} to wait for next month? Pay {formatUsd(amountCents)} back now instead of crediting the rent.
      </p>
      <PayBackButton claimId={claimId} amount={formatUsd(amountCents)} tenantName={tenantName} />
    </div>
  ) : (
    <p className="mt-4 text-sm text-stone-600">
      {landlordName} can also pay this back to your PayPal right away instead of crediting next month&apos;s rent.
    </p>
  );
}
