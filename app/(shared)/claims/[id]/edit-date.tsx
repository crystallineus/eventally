"use client";

import { useActionState, useState } from "react";
import { changeIssueDate, type FormState } from "../actions";

// Lets the submitter correct the day the problem was reported, e.g. after the review's date check flags it.
export function EditDate({ claimId, date, max }: { claimId: string; date: string | null; max: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(changeIssueDate, { error: null });
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="mt-1 text-xs text-stone-500 underline hover:text-stone-800">
        {date ? "Edit date" : "Add the date it was reported"}
      </button>
    );
  }
  return (
    <form action={action} className="mt-1 flex flex-wrap items-center gap-1 text-xs">
      <input type="hidden" name="claimId" value={claimId} />
      <input
        name="date"
        type="date"
        defaultValue={date ?? undefined}
        max={max}
        aria-label="Date the problem was reported"
        autoFocus
        className="rounded-md border border-stone-300 px-2 py-1 text-sm"
      />
      <button disabled={pending} className="rounded-full bg-stone-900 px-2.5 py-1 font-medium text-white disabled:opacity-50">
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="px-1 text-stone-500 hover:text-stone-800">
        Cancel
      </button>
      <span className="w-full text-stone-500">Changing the date clears any proposed split. Ask Aunt Tally to review again when you&apos;re done.</span>
      {state.error && <span role="alert" className="w-full text-red-700">{state.error}</span>}
    </form>
  );
}
