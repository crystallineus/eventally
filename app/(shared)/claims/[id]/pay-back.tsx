"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { payBackNow, refreshPayout, type FormState } from "../actions";

export function PayBackButton({ claimId, amount, tenantName }: { claimId: string; amount: string; tenantName: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(payBackNow, { error: null });
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Send ${amount} to ${tenantName}'s PayPal now? It won't be credited on the next rent invoice. PayPal may charge you a small fee.`)) {
          e.preventDefault();
        }
      }}
      className="mt-3 flex flex-wrap items-center gap-3"
    >
      <input type="hidden" name="claimId" value={claimId} />
      <button disabled={pending} className="rounded-lg bg-[#0070ba] px-4 py-2 text-sm font-medium text-white hover:bg-[#005ea6] disabled:opacity-50">
        {pending ? "Sending…" : `Pay ${tenantName} back now via PayPal`}
      </button>
      {state.error && <p role="alert" className="w-full text-sm text-red-700">{state.error}</p>}
    </form>
  );
}

/** While PayPal is processing a payout, check its status every few seconds. */
export function PayoutWatcher({ claimId }: { claimId: string }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(async () => {
      await refreshPayout(claimId);
      router.refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [claimId, router]);
  return null;
}
