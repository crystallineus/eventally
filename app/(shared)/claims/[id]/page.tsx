import Link from "next/link";
import { notFound } from "next/navigation";
import { ClaimStatus } from "@/app/components/claim-status";
import { getClaimDetail, getClaimForUser, isOpen } from "@/lib/claims";
import { formatUsd } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { approve } from "../actions";
import { AddEvidenceForm } from "./add-evidence-form";
import { SplitForm } from "./split-form";
import { WithdrawButton } from "./withdraw-button";

const KIND_LABELS = { receipt: "Receipt", before: "Before", after: "After" } as const;

export default async function ClaimPage({ params }: PageProps<"/claims/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const found = await getClaimForUser(id, user.id);
  if (!found) notFound();
  const { claim, lease, role } = found;
  const { evidence, events, names } = await getClaimDetail(claim.id);

  const submitter = names.get(claim.submittedBy) ?? "Unknown";
  const tenantPaid = claim.submittedBy !== lease.landlordId;
  const myApproval = role === "landlord" ? claim.landlordApprovedAt : claim.tenantApprovedAt;
  const open = isOpen(claim);

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
          </div>
        </div>
        <p className="mt-4 whitespace-pre-line text-stone-800">{claim.description}</p>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Evidence</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {(["receipt", "before", "after"] as const).map((kind) => {
            const items = evidence.filter((e) => e.kind === kind);
            return (
              <div key={kind} className="rounded-xl border border-stone-200 bg-white p-3">
                <h3 className="mb-2 text-sm font-medium">{KIND_LABELS[kind]}</h3>
                {items.length === 0 ? (
                  <p className="text-sm text-stone-400">None yet</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {items.map((e) => (
                      <a key={e.id} href={`/api/evidence/${e.id}`} target="_blank" className="block overflow-hidden rounded-lg ring-1 ring-stone-200">
                        {/* eslint-disable-next-line @next/next/no-img-element -- served from our auth-checked route */}
                        <img src={`/api/evidence/${e.id}`} alt={`${KIND_LABELS[kind]} photo uploaded by ${names.get(e.uploadedBy)}`} className="aspect-square w-full object-cover" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {open && <AddEvidenceForm claimId={claim.id} />}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="font-semibold">Who pays</h2>
        {claim.landlordShareCents == null ? (
          <p className="mt-2 text-sm text-stone-600">No split proposed yet. Either of you can propose one below.</p>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
              <Share label="Landlord pays" cents={claim.landlordShareCents} approvedAt={claim.landlordApprovedAt} />
              <Share label="Tenant pays" cents={claim.tenantShareCents ?? 0} approvedAt={claim.tenantApprovedAt} />
            </dl>
            {claim.splitRationale && <p className="mt-3 rounded-lg bg-stone-50 p-3 text-sm text-stone-700">{claim.splitRationale}</p>}
            <p className="mt-3 text-sm text-stone-600">
              {tenantPaid
                ? `On approval, ${formatUsd(claim.landlordShareCents)} is credited on the tenant's next rent invoice.`
                : `On approval, ${formatUsd(claim.tenantShareCents ?? 0)} is added to the tenant's next rent invoice.`}
            </p>
          </>
        )}

        {claim.status === "awaiting_approval" && !myApproval && (
          <form action={approve} className="mt-4">
            <input type="hidden" name="claimId" value={claim.id} />
            <button className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600">Approve this split</button>
          </form>
        )}
        {claim.status === "awaiting_approval" && myApproval && (
          <p className="mt-4 text-sm text-stone-600">You approved. Waiting for the {role === "landlord" ? "tenant" : "landlord"}.</p>
        )}
        {open && <SplitForm claimId={claim.id} hasProposal={claim.landlordShareCents != null} />}
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Claim history</h2>
        <ol className="space-y-2 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3 rounded-lg bg-white px-4 py-2 ring-1 ring-stone-200">
              <time className="shrink-0 font-mono text-xs leading-5 text-stone-500" dateTime={e.createdAt.toISOString()}>
                {e.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
              </time>
              <span className="shrink-0 rounded bg-stone-100 px-1.5 text-xs leading-5 capitalize text-stone-600">{e.actor}</span>
              <span className="text-stone-800">{e.type}</span>
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
        {approvedAt ? `✓ Approved ${approvedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}` : "Not approved yet"}
      </dd>
    </div>
  );
}
