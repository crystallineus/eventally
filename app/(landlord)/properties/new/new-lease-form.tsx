"use client";

import { useActionState } from "react";
import { createLease, type LeaseFormState } from "@/app/actions";

const input = "mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-stone-900 focus:outline-none";

export function NewLeaseForm() {
  const [state, action, pending] = useActionState<LeaseFormState, FormData>(createLease, { error: null });
  const v = state.values ?? {};

  return (
    <form action={action} className="space-y-6 rounded-2xl bg-white shadow-card p-5">
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-semibold">Property</legend>
        <Label text="Property name">
          <input name="propertyName" defaultValue={v.propertyName} className={input} required />
        </Label>
        <Label text="Address">
          <input name="address" defaultValue={v.address} className={input} required />
        </Label>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Terms</legend>
        <Label text="Monthly rent (USD)">
          <input name="rent" inputMode="decimal" placeholder="2,000.00" defaultValue={v.rent} className={input} required />
        </Label>
        <Label text="Deposit (USD)">
          <input name="deposit" inputMode="decimal" placeholder="2,000.00" defaultValue={v.deposit ?? "0"} className={input} required />
        </Label>
        <Label text="Rent due day (1–28)">
          <input name="dueDay" type="number" min={1} max={28} defaultValue={v.dueDay ?? "1"} className={input} required />
        </Label>
        <Label text="Start date">
          <input name="startDate" type="date" defaultValue={v.startDate} className={input} required />
        </Label>
        <Label text="End date (optional)">
          <input name="endDate" type="date" defaultValue={v.endDate} className={input} />
        </Label>
      </fieldset>

      <Label text="Repair clause">
        <textarea name="repairClause" rows={6} defaultValue={v.repairClause} className={input} required />
      </Label>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">Invite tenant</legend>
        <Label text="Name">
          <input name="tenantName" defaultValue={v.tenantName} className={input} required />
        </Label>
        <Label text="Email">
          <input name="tenantEmail" type="email" defaultValue={v.tenantEmail} className={input} required />
        </Label>
        <Label text="PayPal email (if different)">
          <input name="tenantPaypalEmail" type="email" defaultValue={v.tenantPaypalEmail} className={input} />
        </Label>
      </fieldset>

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      <button
        disabled={pending}
        className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create lease"}
      </button>
    </form>
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
