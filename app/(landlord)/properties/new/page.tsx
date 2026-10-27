import { NewLeaseForm } from "./new-lease-form";

export default function NewLeasePage() {
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
