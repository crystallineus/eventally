import Link from "next/link";
import { BackToLedger } from "@/app/components/back-to-ledger";
import { notFound } from "next/navigation";
import { Assistant } from "@/app/components/assistant";
import { getLedger, getLeasesForUser, roleIn } from "@/lib/ledger";
import { requireUser } from "@/lib/session";
import { MonthCard, MoreLink } from "../parts";

// One rent month, e.g. /ledger/2026-11. Aunt Tally links here when she explains a bill.
export default async function MonthPage({ params, searchParams }: PageProps<"/ledger/[period]">) {
  const user = await requireUser();
  const [{ period }, { lease: leaseParam }] = await Promise.all([params, searchParams]);
  const leases = await getLeasesForUser(user.id);
  const lease = leases.find((l) => l.id === leaseParam) ?? leases[0];
  if (!lease) notFound();
  const ledger = await getLedger(lease);
  const month = ledger.periods.find((p) => p.period === period);
  if (!month) notFound();
  const role = roleIn(lease, user.id);
  const claimIds = [...new Set(month.entries.map((e) => e.claimId).filter((id): id is string => !!id))];

  return (
    <div className="space-y-6">
      <Assistant leaseId={lease.id} role={role} firstName={user.name.split(" ")[0]} />
      <div>
        <BackToLedger leaseId={lease.id} />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{month.label} rent</h1>
      </div>
      <MonthCard p={month} lease={lease} role={role} canPaySaved={!!user.paypalVaultId} link={false} />
      {claimIds.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Repair claims on this invoice</h2>
          <ul className="space-y-1 text-sm">
            {claimIds.map((id) => (
              <li key={id}>
                <Link href={`/claims/${id}`} className="text-sky-800 underline">
                  {month.entries.find((e) => e.claimId === id)?.description}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <MoreLink href={`/ledger/history?lease=${lease.id}`} label="All months" />
    </div>
  );
}
