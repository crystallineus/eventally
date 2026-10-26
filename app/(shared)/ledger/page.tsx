import Link from "next/link";
import { ClaimStatus } from "@/app/components/claim-status";
import { condenseReviews, describeEvent } from "@/app/components/event-label";
import { listClaims } from "@/lib/claims";
import { getLedger, getLeasesForUser, roleIn, type LeaseWithParties } from "@/lib/ledger";
import { formatUsd } from "@/lib/money";
import { formatLeaseTerm } from "@/lib/period";
import { requireUser } from "@/lib/session";
import { PaymentWatcher, RefreshInvoiceButton, SendInvoiceButton } from "./invoice-controls";

export default async function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  const user = await requireUser();
  const leases = await getLeasesForUser(user.id);
  const { lease: leaseParam } = await searchParams;
  const lease = leases.find((l) => l.id === leaseParam) ?? leases[0];

  if (!lease) {
    return <p className="text-stone-600">No leases yet. A landlord can add one from Properties.</p>;
  }

  const [ledger, claims] = await Promise.all([getLedger(lease), listClaims(lease.id)]);
  const role = roleIn(lease, user.id);

  const awaitingPayment = ledger.periods.some((p) => p.invoice?.status === "sent");
  const outstanding = ledger.periods.find((p) => p.invoice?.status === "sent" || p.invoice?.status === "draft");

  return (
    <div className="space-y-8">
      {awaitingPayment && <PaymentWatcher />}
      {leases.length > 1 && (
        <nav className="flex flex-wrap gap-2 text-sm">
          {leases.map((l) => (
            <Link
              key={l.id}
              href={`/ledger?lease=${l.id}`}
              aria-current={l.id === lease.id ? "page" : undefined}
              className="rounded-full border border-stone-300 px-3 py-1 aria-[current=page]:border-stone-900 aria-[current=page]:bg-stone-900 aria-[current=page]:text-white"
            >
              {l.propertyName}
            </Link>
          ))}
        </nav>
      )}

      <LeaseSummary lease={lease} role={role} balanceCents={ledger.balanceCents} />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Repair claims</h2>
          <Link
            href={`/claims/new?lease=${lease.id}`}
            className="rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
          >
            New claim
          </Link>
        </div>
        {claims.length === 0 ? (
          <p className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-600">
            No claims yet. Paid for a repair? Submit the receipt and photos here.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
            {claims.map((c) => (
              <li key={c.id}>
                <Link href={`/claims/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 hover:bg-stone-50">
                  <span>
                    <span className="font-medium">{c.title}</span>
                    <span className="ml-2 text-sm text-stone-500">
                      {c.submittedBy === lease.landlordId ? "paid by landlord" : "paid by tenant"}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <ClaimStatus status={c.status} />
                    <span className="tabular-nums">{formatUsd(c.amountCents ?? 0)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-dashed border-stone-300 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Next invoice · {ledger.upcoming.label}</h2>
          <span className="text-sm text-stone-500">Preview — sent via PayPal before rent is due</span>
        </div>
        <Lines lines={ledger.upcoming.invoice.lines} />
        <TotalRow label="Total due" cents={ledger.upcoming.invoice.totalCents} />
        {ledger.upcoming.invoice.carryOverCents > 0 && (
          <p className="mt-2 text-sm text-stone-600">
            {formatUsd(ledger.upcoming.invoice.carryOverCents)} of credit carries over to the following month.
          </p>
        )}
        {role === "landlord" && outstanding ? (
          <p className="mt-3 text-sm text-stone-500">You can send this after the {outstanding.label} invoice is paid.</p>
        ) : role === "landlord" ? (
          <SendInvoiceButton leaseId={lease.id} />
        ) : (
          <p className="mt-3 text-sm text-stone-500">{lease.landlord.name} sends this as a PayPal invoice before rent is due.</p>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold">History</h2>
        <div className="space-y-4">
          {ledger.periods.map((p) => (
            <div key={p.period} className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="flex items-baseline justify-between">
                <h3 className="font-medium">{p.label}</h3>
                <StatusBadge invoiceStatus={p.invoice?.status ?? null} settled={p.balanceCents === 0} />
              </div>
              <Lines lines={p.entries.map((e) => ({ name: e.description, amountCents: e.amountCents }))} />
              <TotalRow label="Balance" cents={p.balanceCents} />
              {p.invoice && p.invoice.status !== "paid" && (
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  {role === "tenant" && p.invoice.status === "sent" && p.invoice.payerUrl && (
                    <a
                      href={p.invoice.payerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-[#ffc439] px-4 py-2 text-sm font-semibold text-[#003087] hover:bg-[#f2ba36]"
                    >
                      Pay with PayPal
                    </a>
                  )}
                  {role === "landlord" && <RefreshInvoiceButton invoiceId={p.invoice.id} draft={p.invoice.status === "draft"} />}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Activity log</h2>
        <p className="mb-3 text-sm text-stone-500">
          Every step — agent checks and reasoning, approvals, payments — is recorded here and visible to both of you.
        </p>
        <ActivityList events={condenseReviews(ledger.events)} />
      </section>
    </div>
  );
}

function LeaseSummary({ lease, role, balanceCents }: { lease: LeaseWithParties; role: "landlord" | "tenant"; balanceCents: number }) {
  const landlord = lease.landlord.businessName ? `${lease.landlord.name} · ${lease.landlord.businessName}` : lease.landlord.name;
  return (
    <section className="grid gap-4 rounded-xl border border-stone-200 bg-white p-5 sm:grid-cols-[1fr_auto]">
      <div>
        <p className="text-sm text-stone-500">You are the {role}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{lease.propertyName}</h1>
        <p className="text-stone-600">{lease.address}</p>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Field label="Landlord" value={landlord} />
          <Field label="Tenant" value={lease.tenant?.name ?? "Invite pending"} />
          <Field label="Rent" value={`${formatUsd(lease.rentCents)} / month`} />
          <Field label="Due" value={`Day ${lease.dueDay} of each month`} />
          <Field label="Lease term" value={formatLeaseTerm(lease.startDate, lease.endDate)} />
        </dl>
      </div>
      <div className="rounded-lg bg-stone-50 p-4 sm:min-w-48 sm:text-right">
        <p className="text-sm text-stone-500">Balance owed</p>
        <p className="text-2xl font-semibold tabular-nums">{formatUsd(balanceCents)}</p>
        <p className="text-sm text-stone-500">{balanceCents === 0 ? "All settled" : "Outstanding"}</p>
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-stone-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Lines({ lines }: { lines: { name: string; amountCents: number }[] }) {
  return (
    <ul className="mt-3 divide-y divide-stone-100 text-sm">
      {lines.map((l, i) => (
        <li key={i} className="flex justify-between gap-4 py-2">
          <span>{l.name}</span>
          <span className={`tabular-nums ${l.amountCents < 0 ? "text-emerald-700" : ""}`}>{formatUsd(l.amountCents)}</span>
        </li>
      ))}
    </ul>
  );
}

function TotalRow({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="mt-1 flex justify-between border-t border-stone-200 pt-2 text-sm font-semibold">
      <span>{label}</span>
      <span className="tabular-nums">{formatUsd(cents)}</span>
    </div>
  );
}

function StatusBadge({ invoiceStatus, settled }: { invoiceStatus: "draft" | "sent" | "paid" | "cancelled" | null; settled: boolean }) {
  const [label, className] =
    invoiceStatus === "sent"
      ? ["Invoice sent · awaiting payment", "bg-sky-50 text-sky-700"]
      : invoiceStatus === "draft"
        ? ["Not sent yet", "bg-red-50 text-red-700"]
        : settled
          ? ["Paid", "bg-emerald-50 text-emerald-700"]
          : ["Open", "bg-amber-50 text-amber-700"];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{label}</span>;
}

const ACTIVITY_PREVIEW = 3;

type ActivityEvent = { id: string; type: string; actor: string; data: unknown; createdAt: Date };

/** The latest few events, with the rest behind "Show more". */
function ActivityList({ events }: { events: ActivityEvent[] }) {
  const rest = events.slice(ACTIVITY_PREVIEW);
  return (
    <>
      <ActivityItems events={events.slice(0, ACTIVITY_PREVIEW)} />
      {rest.length > 0 && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-sm font-medium text-stone-600 hover:text-stone-900">
            <span className="group-open:hidden">Show more ({rest.length})</span>
            <span className="hidden group-open:inline">Show less</span>
          </summary>
          <div className="mt-2">
            <ActivityItems events={rest} />
          </div>
        </details>
      )}
    </>
  );
}

function ActivityItems({ events }: { events: ActivityEvent[] }) {
  return (
    <ol className="space-y-2 text-sm">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 rounded-lg bg-white px-4 py-2 ring-1 ring-stone-200">
          <time className="shrink-0 font-mono text-xs leading-5 text-stone-500" dateTime={e.createdAt.toISOString()}>
            {e.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
          </time>
          <span className="shrink-0 rounded bg-stone-100 px-1.5 text-xs leading-5 capitalize text-stone-600">{e.actor}</span>
          <span className="text-stone-800">{describeEvent(e.type, e.data)}</span>
        </li>
      ))}
    </ol>
  );
}
