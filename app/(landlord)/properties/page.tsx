import Link from "next/link";
import { getLeasesForUser } from "@/lib/ledger";
import { formatUsd } from "@/lib/money";
import { formatLeaseTerm } from "@/lib/period";
import { requireUser } from "@/lib/session";

export default async function PropertiesPage() {
  const user = await requireUser();
  const leases = (await getLeasesForUser(user.id)).filter((l) => l.landlordId === user.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Properties</h1>
        <Link href="/properties/new" className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">
          New lease
        </Link>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {leases.map((l) => (
          <li key={l.id} className="rounded-2xl bg-white shadow-card p-5">
            <h2 className="text-lg font-semibold tracking-tight">{l.propertyName}</h2>
            <p className="text-sm text-stone-600">{l.address}</p>
            <p className="mt-3 text-sm">
              {l.tenant?.name ?? "Invite pending"} · {formatUsd(l.rentCents)} / month · due day {l.dueDay}
            </p>
            <p className="text-sm text-stone-600">Lease term: {formatLeaseTerm(l.startDate, l.endDate)}</p>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-stone-600">Repair clause</summary>
              <p className="mt-2 whitespace-pre-line text-stone-700">{l.repairClause}</p>
            </details>
            <Link href={`/ledger?lease=${l.id}`} className="mt-4 inline-block text-sm font-medium text-stone-900 underline">
              Open ledger
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
