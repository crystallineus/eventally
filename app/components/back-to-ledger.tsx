import Link from "next/link";

/** The way back from a claim or history page; `pulse` when the tour's next step is on the ledger. */
export function BackToLedger({ leaseId, pulse = false }: { leaseId: string; pulse?: boolean }) {
  return (
    <Link
      href={`/ledger?lease=${leaseId}`}
      className={`inline-block rounded-full border border-stone-300 bg-white px-3.5 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 ${pulse ? "tour-pulse" : ""}`}
    >
      Back to ledger
    </Link>
  );
}
