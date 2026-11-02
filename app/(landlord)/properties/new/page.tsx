import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { NewLeaseForm } from "./new-lease-form";

export default async function NewLeasePage() {
  // Not in the demo: each visitor's demo has its one ready-made lease (Maple Street).
  if ((await requireUser()).demoId) redirect("/properties");
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New lease</h1>
        <p className="mt-1 text-stone-600">
          Paste the lease&apos;s repair clause word for word — the agent cites it when it proposes who pays for a repair.
        </p>
      </div>
      <NewLeaseForm />
    </div>
  );
}
