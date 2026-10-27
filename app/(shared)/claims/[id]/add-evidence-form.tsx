"use client";

import { useActionState, useState, useTransition } from "react";
import { withResizedImages } from "@/app/components/resize-images";
import { uploadEvidence, type FormState } from "../actions";

export function AddEvidenceForm({ claimId }: { claimId: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadEvidence, { error: null });
  const [resizeError, setResizeError] = useState<string | null>(null);
  const [preparing, startPreparing] = useTransition();
  const [kind, setKind] = useState("after");
  const busy = pending || preparing;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setResizeError(null);
        startPreparing(async () => {
          try {
            const data = await withResizedImages(form);
            startPreparing(() => action(data));
            form.reset();
          } catch (err) {
            setResizeError(err instanceof Error ? err.message : "Couldn't prepare the photos");
          }
        });
      }}
      className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-stone-300 bg-white p-4 text-sm"
    >
      <input type="hidden" name="claimId" value={claimId} />
      <label className="text-stone-700">
        Add photos
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 block rounded-lg border border-stone-300 bg-white px-2 py-1.5">
          <option value="after">After the repair</option>
          <option value="before">Before the repair</option>
          <option value="receipt">Receipt</option>
        </select>
      </label>
      <input name={kind} type="file" accept="image/*" multiple required className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-1.5" />
      <button disabled={busy} className="rounded-lg bg-stone-900 px-3 py-1.5 font-medium text-white hover:bg-stone-700 disabled:opacity-50">
        {busy ? "Uploading…" : "Upload"}
      </button>
      {(resizeError ?? state.error) && (
        <p role="alert" className="w-full text-red-700">
          {resizeError ?? state.error}
        </p>
      )}
    </form>
  );
}
