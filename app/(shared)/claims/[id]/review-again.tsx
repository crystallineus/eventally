"use client";

import { useActionState } from "react";
import { reviewAgain, type FormState } from "../actions";
import { ASSISTANT } from "@/lib/persona";

export function ReviewAgainButton({ claimId, reviewsLeft }: { claimId: string; reviewsLeft: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(reviewAgain, { error: null });
  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-3">
      <input type="hidden" name="claimId" value={claimId} />
      <button disabled={pending} className="rounded-full bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50">
        {pending ? "Starting…" : "Review again"}
      </button>
      <span className="text-sm text-amber-800">
        {reviewsLeft === 1 ? `This will be ${ASSISTANT.name}'s last review.` : `${ASSISTANT.name} can review it ${reviewsLeft} more times.`}
      </span>
      {state.error && <p role="alert" className="w-full text-sm text-red-700">{state.error}</p>}
    </form>
  );
}
