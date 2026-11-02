import { BackToLedger } from "@/app/components/back-to-ledger";
import { notFound } from "next/navigation";
import { Assistant } from "@/app/components/assistant";
import { getLedger, getLeasesForUser, roleIn } from "@/lib/ledger";
import { requireUser } from "@/lib/session";
import { MonthCard } from "../parts";

// Every rent month on a lease, newest first. The ledger page shows only the latest.
export default async function RentHistoryPage({ searchParams }: PageProps<"/ledger/history">) {
  const user = await requireUser();
  const { lease: leaseParam } = await searchParams;
  const leases = await getLeasesForUser(user.id);
  const lease = leases.find((l) => l.id === leaseParam) ?? leases[0];
  if (!lease) notFound();
  const ledger = await getLedger(lease);
  const role = roleIn(lease, user.id);

  return (
    <div className="space-y-6">
      <Assistant leaseId={lease.id} role={role} firstName={user.name.split(" ")[0]} />
      <div>
        <BackToLedger leaseId={lease.id} />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Rent history</h1>
      </div>
      {ledger.periods.length === 0 ? (
        <p className="text-stone-600">No rent months yet.</p>
      ) : (
        <div className="space-y-4">
          {ledger.periods.map((p) => (
            <MonthCard key={p.period} p={p} lease={lease} role={role} canPaySaved={!!user.paypalVaultId} />
          ))}
        </div>
      )}
    </div>
  );
}
