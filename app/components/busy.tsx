"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { AuntTallyAvatar } from "@/app/components/aunt-tally";

// A full-screen "please wait" for actions that take a few seconds (creating a demo, calling PayPal),
// so nobody presses the button again. It also blocks clicks while it's up.
export function BusyOverlay({ show, message }: { show: boolean; message: string }) {
  if (!show) return null;
  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-50 grid place-items-center bg-stone-50/70 backdrop-blur-[2px]">
      <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-medium text-stone-800 shadow-xl ring-1 ring-sky-100">
        <span className="relative grid size-9 place-items-center">
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-sky-200 border-t-sky-600" aria-hidden />
          <AuntTallyAvatar size={26} />
        </span>
        {message}
      </div>
    </div>
  );
}

/** Shows the overlay while the surrounding form's server action runs. Put it inside the <form>. */
export function FormBusy({ message }: { message: string }) {
  const { pending } = useFormStatus();
  return <BusyOverlay show={pending} message={message} />;
}

/**
 * A plain form that posts to a URL (a route handler that redirects). The browser navigates away, so
 * the overlay just stays until the next page arrives; it clears if the visitor comes back with Back.
 */
export function PostForm({ action, message, className, children }: { action: string; message: string; className?: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const reset = () => setBusy(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  return (
    <form action={action} method="post" className={className} onSubmit={() => setBusy(true)}>
      {children}
      <BusyOverlay show={busy} message={message} />
    </form>
  );
}
