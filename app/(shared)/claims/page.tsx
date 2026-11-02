import { BackToLedger } from "@/app/components/back-to-ledger";
import { notFound } from "next/navigation";
import { Assistant } from "@/app/components/assistant";
import { listClaims } from "@/lib/claims";
import { getLeasesForUser, roleIn } from "@/lib/ledger";
import { requireUser } from "@/lib/session";
import { getTour, nextHrefFor } from "@/lib/tour";
import { ClaimList, CLOSED } from "../ledger/parts";

// Every repair claim on a lease: open ones first, then closed (settled, paid back, withdrawn).
export default async function ClaimsPage({ searchParams }: PageProps<"/claims">) {
  const user = await requireUser();
  const { lease: leaseParam } = await searchParams;
  const leases = await getLeasesForUser(user.id);
  const lease = leases.find((l) => l.id === leaseParam) ?? leases[0];
  if (!lease) notFound();
  const [claims, tour] = await Promise.all([listClaims(lease.id, user.id), getTour(user)]);
  const open = claims.filter((c) => !CLOSED.includes(c.status));
  const closed = claims.filter((c) => CLOSED.includes(c.status));

  return (
    <div className="space-y-6">
      <Assistant leaseId={lease.id} role={roleIn(lease, user.id)} firstName={user.name.split(" ")[0]} />
      <div>
        <BackToLedger leaseId={lease.id} />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Repair claims</h1>
      </div>
      {Object.entries({ Open: open, Closed: closed }).map(([label, list]) => (
        <section key={label}>
          <h2 className="mb-2 font-semibold">{label}</h2>
          {list.length ? <ClaimList claims={list} lease={lease} pulseHref={nextHrefFor(tour)} /> : <p className="text-sm text-stone-500">None.</p>}
        </section>
      ))}
    </div>
  );
}
