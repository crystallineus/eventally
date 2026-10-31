"use client";

import { useActionState, useState, useTransition } from "react";
import { submitClaim, type FormState } from "../actions";
import { withResizedImages } from "@/app/components/resize-images";
import { BusyOverlay } from "@/app/components/busy";
import { loadSamplePhotos, SAMPLE_CLAIM } from "@/app/components/sample-photos";

const input = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-stone-900 focus:outline-none";

type LeaseOption = { id: string; name: string; isTenant: boolean; landlordName: string };

export function NewClaimForm({ leases, defaultLeaseId, today }: { leases: LeaseOption[]; defaultLeaseId: string; today: string }) {
  const [leaseId, setLeaseId] = useState(defaultLeaseId);
  const selected = leases.find((l) => l.id === leaseId) ?? leases[0];
  const [state, action, pending] = useActionState<FormState, FormData>(submitClaim, { error: null });
  const [resizeError, setResizeError] = useState<string | null>(null);
  const [preparing, startPreparing] = useTransition();
  const busy = pending || preparing;
  const [sampleNote, setSampleNote] = useState<string | null>(null);

  // Demo: fill the form with the range hood repair, photos included.
  async function fillSample(form: HTMLFormElement) {
    setSampleNote("Loading sample photos…");
    try {
      const photos = await loadSamplePhotos();
      const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
      field("title").value = SAMPLE_CLAIM.title;
      field("description").value = SAMPLE_CLAIM.description;
      field("issueDate").value = SAMPLE_CLAIM.issueDate;
      field("amount").value = SAMPLE_CLAIM.amount;
      for (const { kind, file } of photos) {
        const files = new DataTransfer();
        files.items.add(file);
        (field(kind) as HTMLInputElement).files = files.files;
      }
      setSampleNote("Sample filled in. Check it over, then press Submit.");
    } catch (err) {
      setSampleNote(err instanceof Error ? err.message : "Couldn't load the sample");
    }
  }

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
      className="space-y-5 rounded-2xl bg-white shadow-card p-5"
    >
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-sky-50 px-3 py-2 text-sm">
        <span className="text-sky-900">No receipt handy?</span>
        <button
          type="button"
          disabled={busy}
          onClick={(e) => fillSample(e.currentTarget.form!)}
          className="rounded-full border border-sky-300 bg-white px-3 py-1 font-medium text-sky-800 hover:border-sky-500 disabled:opacity-50"
        >
          Fill in a sample claim
        </button>
        {sampleNote && <span className="text-sky-800">{sampleNote}</span>}
      </div>
      {leases.length > 1 ? (
        <Label text="Property">
          <select name="leaseId" value={leaseId} onChange={(e) => setLeaseId(e.target.value)} className={input}>
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

      {selected.isTenant && (
        <label className="flex items-start gap-2 rounded-lg bg-stone-50 p-3 text-sm text-stone-700">
          <input type="checkbox" name="wantsPayout" className="mt-0.5" />
          <span>
            Pay me back right away via PayPal, if {selected.landlordName} agrees.
            <span className="block text-stone-500">Otherwise your share is credited on the next rent invoice. You can change this later.</span>
          </span>
        </label>
      )}

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
      <button disabled={busy} className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50">
        {busy ? "Uploading…" : "Submit"}
      </button>
      <BusyOverlay show={busy} message="Uploading your claim and photos…" />
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
