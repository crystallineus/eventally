"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { payWithSaved, refreshInvoice, sendNextInvoice, type InvoiceFormState } from "./actions";

export function SendInvoiceButton({ leaseId }: { leaseId: string }) {
  const [state, action, pending] = useActionState<InvoiceFormState, FormData>(sendNextInvoice, { error: null });
  return (
    <form action={action} className="mt-4 flex flex-wrap items-center gap-3">
      <input type="hidden" name="leaseId" value={leaseId} />
      <button disabled={pending} className="rounded-full bg-[#0070ba] px-4 py-2 text-sm font-medium text-white hover:bg-[#005ea6] disabled:opacity-50">
        {pending ? "Sending…" : "Send invoice via PayPal"}
      </button>
      <span className="text-sm text-stone-500">Approved claims are added; the tenant gets a PayPal invoice by email.</span>
      {state.error && <p role="alert" className="w-full text-sm text-red-700">{state.error}</p>}
    </form>
  );
}

export function RefreshInvoiceButton({ invoiceId, draft }: { invoiceId: string; draft: boolean }) {
  const [state, action, pending] = useActionState<InvoiceFormState, FormData>(refreshInvoice, { error: null });
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <button disabled={pending} className="text-sm text-stone-600 underline hover:text-stone-900 disabled:opacity-50">
        {pending ? "Checking…" : draft ? "Retry sending to PayPal" : "Check payment with PayPal"}
      </button>
      {(state.error ?? state.note) && <span className={`text-sm ${state.error ? "text-red-700" : "text-stone-500"}`}>{state.error ?? state.note}</span>}
    </form>
  );
}

export function PayWithSavedButton({ leaseId, invoiceId, label }: { leaseId: string; invoiceId: string; label: string }) {
  const [state, action, pending] = useActionState<InvoiceFormState, FormData>(payWithSaved, { error: null });
  return (
    <form action={action} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="leaseId" value={leaseId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <button disabled={pending} className="rounded-full bg-[#0070ba] px-4 py-2 text-sm font-medium text-white hover:bg-[#005ea6] disabled:opacity-50">
        {pending ? "Paying…" : label}
      </button>
      {state.error && <span className="text-sm text-red-700">{state.error}</span>}
    </form>
  );
}

/** While an invoice is out for payment, refresh the ledger so a PayPal webhook shows up live. */
export function PaymentWatcher() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [router]);
  return null;
}
