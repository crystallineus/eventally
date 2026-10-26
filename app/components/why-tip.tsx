"use client";

import { useEffect, useId, useRef, useState } from "react";

// A small "?" button that reveals the agent's reason for a step in a popover.
export function WhyTip({ why }: { why: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-block align-middle">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        aria-label="Why did the AI take this step?"
        className="grid size-5 place-items-center rounded-full border border-stone-300 text-xs font-semibold text-stone-500 hover:border-stone-500 hover:text-stone-800 aria-expanded:border-sky-500 aria-expanded:bg-sky-50 aria-expanded:text-sky-700"
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-7 top-1/2 z-10 w-72 max-w-[calc(100vw-4rem)] -translate-y-1/2 rounded-lg border border-stone-200 bg-white p-3 text-xs leading-relaxed text-stone-700 shadow-lg"
        >
          <span className="mb-1 block font-semibold text-stone-900">Why this step</span>
          {why}
        </span>
      )}
    </span>
  );
}
