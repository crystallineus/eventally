import type { schema } from "@/lib/db";

type Status = (typeof schema.claimStatus.enumValues)[number];

const STYLES: Record<Status, { label: string; className: string }> = {
  reviewing: { label: "In review", className: "bg-sky-50 text-sky-700" },
  needs_evidence: { label: "Waiting for changes", className: "bg-amber-50 text-amber-700" },
  awaiting_approval: { label: "Awaiting approval", className: "bg-violet-50 text-violet-700" },
  approved: { label: "Approved · next invoice", className: "bg-emerald-50 text-emerald-700" },
  invoiced: { label: "On invoice", className: "bg-emerald-50 text-emerald-700" },
  settled: { label: "Settled", className: "bg-stone-100 text-stone-600" },
  withdrawn: { label: "Withdrawn", className: "bg-stone-100 text-stone-500" },
};

export function ClaimStatus({ status }: { status: Status }) {
  const { label, className } = STYLES[status];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{label}</span>;
}
