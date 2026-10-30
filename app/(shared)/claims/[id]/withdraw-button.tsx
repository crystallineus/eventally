"use client";

import { withdraw } from "../actions";

// Withdrawing can't be undone, so ask before submitting.
export function WithdrawButton({ claimId }: { claimId: string }) {
  return (
    <form
      action={withdraw}
      onSubmit={(e) => {
        if (!confirm("Withdraw this claim? This can't be undone. You can submit a new claim later.")) e.preventDefault();
      }}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50/50 p-4"
    >
      <input type="hidden" name="claimId" value={claimId} />
      <p className="flex-1 text-sm text-stone-700">Changed your mind? Withdrawing closes this claim for both of you.</p>
      <button className="rounded-full border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
        Withdraw
      </button>
    </form>
  );
}
