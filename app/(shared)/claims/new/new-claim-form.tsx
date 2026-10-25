"use client";

import { useActionState, useState, useTransition } from "react";
import { submitClaim, type FormState } from "../actions";
import { withResizedImages } from "@/app/components/resize-images";

const input = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-stone-900 focus:outline-none";

export function NewClaimForm({ leases, defaultLeaseId, today }: { leases: { id: string; name: string }[]; defaultLeaseId: string; today: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(submitClaim, { error: null });
  const [resizeError, setResizeError] = useState<string | null>(null);
  const [preparing, startPreparing] = useTransition();
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
          } catch (err) {
            setResizeError(err instanceof Error ? err.message : "Couldn't prepare the photos");
          }
        });
      }}
      className="space-y-5 rounded-xl border border-stone-200 bg-white p-5"
    >
      {leases.length > 1 ? (
        <Label text="Property">
          <select name="leaseId" defaultValue={defaultLeaseId} className={input}>
            {leases.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Label>
      ) : (
        <input type="hidden" name="leaseId" value={leases[0].id} />
      )}

      <Label text="What was repaired?">
        <input name="title" placeholder="Kitchen sink leak" className={input} required />
      </Label>
      <Label text="What happened">
        <textarea
          name="description"
          rows={4}
          placeholder="The pipe under the kitchen sink started leaking. Tom asked me to call a plumber, who replaced the P-trap."
          className={input}
          required
        />
      </Label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Label text="Date the problem was reported">
          <input name="issueDate" type="date" max={today} className={input} required />
        </Label>
        <Label text="Receipt total (USD)">
          <input name="amount" inputMode="decimal" placeholder="240.00" className={input} required />
        </Label>
      </div>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Photos</legend>
        <FileField name="receipt" label="Receipt (required)" />
        <FileField name="before" label="Before the repair" />
        <FileField name="after" label="After the repair" />
      </fieldset>

      {(resizeError ?? state.error) && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {resizeError ?? state.error}
        </p>
      )}
      <button disabled={busy} className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">
        {busy ? "Uploading…" : "Submit claim"}
      </button>
    </form>
  );
}

export function FileField({ name, label }: { name: string; label: string }) {
  return (
    <Label text={label}>
      <input
        name={name}
        type="file"
        accept="image/*"
        multiple
        className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-stone-100 file:px-3 file:py-1.5 file:text-sm hover:file:bg-stone-200"
      />
    </Label>
  );
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm text-stone-700">
      {text}
      {children}
    </label>
  );
}
