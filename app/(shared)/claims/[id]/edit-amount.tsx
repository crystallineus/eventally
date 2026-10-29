"use client";

import { useActionState, useState } from "react";
import { formatUsd, toApiValue } from "@/lib/money";
import { changeAmount, type FormState } from "../actions";

// Lets the submitter correct the claimed amount. When the AI read a different receipt total,
// offer it as a one-click fix.
export function EditAmount({ claimId, amountCents, receiptTotalCents }: { claimId: string; amountCents: number; receiptTotalCents: number | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(changeAmount, { error: null });
  const [editing, setEditing] = useState(false);
  const suggest = receiptTotalCents !== null && receiptTotalCents !== amountCents ? receiptTotalCents : null;

  return (
    <div className="mt-1 flex flex-col items-end gap-1 text-xs">
      {suggest !== null && !editing && (
        <form action={action}>
          <input type="hidden" name="claimId" value={claimId} />
          <input type="hidden" name="amount" value={toApiValue(suggest)} />
          <button disabled={pending} className="rounded-md bg-amber-100 px-2 py-1 font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-50">
            Use receipt total ({formatUsd(suggest)})
          </button>
        </form>
      )}
      {editing ? (
        <form action={action} className="flex items-center gap-1">
          <input type="hidden" name="claimId" value={claimId} />
          <span className="text-stone-500">$</span>
          <input
            name="amount"
            inputMode="decimal"
            defaultValue={toApiValue(amountCents)}
            aria-label="New amount in dollars"
            autoFocus
            className="w-24 rounded-md border border-stone-300 px-2 py-1 text-right text-sm"
          />
          <button disabled={pending} className="rounded-md bg-stone-900 px-2 py-1 font-medium text-white disabled:opacity-50">
            {pending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="px-1 text-stone-500 hover:text-stone-800">
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="text-stone-500 underline hover:text-stone-800">
          Edit amount
        </button>
      )}
      {state.error && <p role="alert" className="text-red-700">{state.error}</p>}
      {editing && <p className="max-w-56 text-right text-stone-500">Changing the amount clears any proposed split. Ask Aunt Tally to review again when you&apos;re done.</p>}
    </div>
  );
}
