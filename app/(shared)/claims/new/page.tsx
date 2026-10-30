import { getLeasesForUser } from "@/lib/ledger";
import { todayInAppZone } from "@/lib/time";
import { requireUser } from "@/lib/session";
import { NewClaimForm } from "./new-claim-form";

export default async function NewClaimPage({ searchParams }: PageProps<"/claims/new">) {
  const user = await requireUser();
  const leases = await getLeasesForUser(user.id);
  const { lease } = await searchParams;

  if (leases.length === 0) return <p className="text-stone-600">You need a lease before you can submit a claim.</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Submit a repair claim</h1>
        <p className="mt-1 text-stone-600">
          Paid for a repair out of pocket? Add the receipt and photos. The other side sees exactly what you upload, and
          once you both agree on the split, it&apos;s settled on the next rent invoice.
        </p>
        <p className="mt-2 text-sm text-stone-500">
          Trying the demo?{" "}
          <a href="/eventally-sample-photos.zip" download className="font-medium text-sky-700 underline hover:text-sky-900">
            Download sample photos
          </a>{" "}
          (fictional receipts and before/after photos).
        </p>
      </div>
      <NewClaimForm
        leases={leases.map((l) => ({ id: l.id, name: l.propertyName, isTenant: l.tenantId === user.id, landlordName: l.landlord.name.split(" ")[0] }))}
        defaultLeaseId={typeof lease === "string" ? lease : leases[0].id}
        today={todayInAppZone()}
      />
    </div>
  );
}
