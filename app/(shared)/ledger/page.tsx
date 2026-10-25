import Link from "next/link";
import { getLedger, getLeasesForUser, roleIn, type LeaseWithParties } from "@/lib/ledger";
import { formatUsd } from "@/lib/money";
import { requireUser } from "@/lib/session";

export default async function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  const user = await requireUser();
  const leases = await getLeasesForUser(user.id);
  const { lease: leaseParam } = await searchParams;
  const lease = leases.find((l) => l.id === leaseParam) ?? leases[0];

  if (!lease) {
    return <p className="text-stone-600">No leases yet. A landlord can add one from Properties.</p>;
  }

  const ledger = await getLedger(lease);
  const role = roleIn(lease, user.id);

  return (
    <div className="space-y-8">
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
      </section>

      <section>
        <h2 className="mb-3 font-semibold">History</h2>
        <div className="space-y-4">
          {ledger.periods.map((p) => (
            <div key={p.period} className="rounded-xl border border-stone-200 bg-white p-5">
              <div className="flex items-baseline justify-between">
                <h3 className="font-medium">{p.label}</h3>
                <StatusBadge settled={p.balanceCents === 0} />
              </div>
              <Lines lines={p.entries.map((e) => ({ name: e.description, amountCents: e.amountCents }))} />
              <TotalRow label="Balance" cents={p.balanceCents} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Activity log</h2>
        <p className="mb-3 text-sm text-stone-500">
          Every step — agent checks and reasoning, approvals, payments — is recorded here and visible to both of you.
        </p>
        <ol className="space-y-2 text-sm">
          {ledger.events.map((e) => (
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
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Field label="Landlord" value={landlord} />
          <Field label="Tenant" value={lease.tenant?.name ?? "Invite pending"} />
          <Field label="Rent" value={`${formatUsd(lease.rentCents)} / month`} />
          <Field label="Due" value={`Day ${lease.dueDay} of each month`} />
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

function StatusBadge({ settled }: { settled: boolean }) {
  return settled ? (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Paid</span>
  ) : (
    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Open</span>
  );
}
