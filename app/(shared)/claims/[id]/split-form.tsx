"use client";

import { useActionState } from "react";
import { submitSplit, type FormState } from "../actions";

// Manual split for now; the AI agent will propose one (with lease citations) in the same shape.
/** `sendTo`: on the submitter's draft, proposing also sends it to this person. */
export function SplitForm({ claimId, hasProposal, sendTo = null }: { claimId: string; hasProposal: boolean; sendTo?: string | null }) {
  const [state, action, pending] = useActionState<FormState, FormData>(submitSplit, { error: null });

  return (
    <details className="mt-4 text-sm" open={!hasProposal}>
      <summary className="cursor-pointer font-medium text-stone-700">{hasProposal ? "Propose a different split" : "Propose a split"}</summary>
      <form action={action} className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
        <input type="hidden" name="claimId" value={claimId} />
        <label className="text-stone-700">
          Landlord pays (%)
          <input name="landlordPercent" type="number" min={0} max={100} step="0.01" defaultValue={100} required className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2" />
        </label>
        <label className="text-stone-700">
          Why
          <input name="rationale" required placeholder="Plumbing repairs not caused by the tenant are the landlord's responsibility (lease §12a)." className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2" />
        </label>
        <button disabled={pending} className="rounded-full bg-stone-900 px-4 py-2 font-medium text-white hover:bg-stone-700 disabled:opacity-50">
          {pending ? "Saving…" : sendTo ? `Propose and send to ${sendTo}` : "Propose"}
        </button>
        <p className="text-xs text-stone-500 sm:col-span-3">
          {sendTo
            ? `Proposing counts as your approval and sends the claim to ${sendTo}, who then approves or proposes something else.`
            : "Proposing counts as your approval. The other side then approves or proposes something else."}
        </p>
        {state.error && (
          <p role="alert" className="text-red-700 sm:col-span-3">
            {state.error}
          </p>
        )}
      </form>
    </details>
  );
}
