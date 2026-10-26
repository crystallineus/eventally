"use client";

import { useFormStatus } from "react-dom";

// A submit button that disables itself while its form's action runs, so a double click
// can't send the same action twice.
export function SubmitButton({ children, pendingLabel, className }: { children: React.ReactNode; pendingLabel?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} aria-disabled={pending} className={className}>
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
