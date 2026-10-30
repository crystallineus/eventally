"use client";

import { TRY_SAMPLE_EVENT } from "@/app/components/assistant";

// The checklist's "Go" for filing a claim with Aunt Tally: opens the chat already on the page.
export function TourAskAunt() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(TRY_SAMPLE_EVENT))}
      className="rounded-full bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
    >
      Open the chat →
    </button>
  );
}
