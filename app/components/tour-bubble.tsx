"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { hideTour, switchUser } from "@/app/actions";
import { TRY_SAMPLE_EVENT } from "@/app/components/assistant";
import { AuntTallyAvatar } from "@/app/components/aunt-tally";
import { FormBusy } from "@/app/components/busy";
import { ASSISTANT } from "@/lib/persona";

export type BubbleAction = { kind: "switch"; userId: string; name: string; next: string } | { kind: "go"; href: string } | { kind: "aunt" };

const MIN_KEY = "eventally-tour-minimized";

// "Minimized" lives in localStorage; useSyncExternalStore reads it without a hydration mismatch.
const listeners = new Set<() => void>();
function readMinimized() {
  try {
    // Open until someone minimizes it, on phones too.
    return localStorage.getItem(MIN_KEY) === "1";
  } catch {
    return false;
  }
}
function writeMinimized(value: boolean) {
  try {
    localStorage.setItem(MIN_KEY, value ? "1" : "0");
  } catch {}
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const button = "rounded-full bg-sky-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-sky-700";

// The speech bubble above "Ask Aunt Tally": the current trial step and its one button. It can
// shrink to a chip (remembered in this browser) or be hidden for good.
export function TourBubble({
  step,
  total,
  done,
  action,
}: {
  step: { index: number; title: string; hint: string } | null;
  total: number;
  done: number;
  action: BubbleAction | null;
}) {
  const pathname = usePathname();
  const minimized = useSyncExternalStore(subscribe, readMinimized, () => false);
  const setMin = writeMinimized;
  useScrollToGlow(step ? `${pathname}#${step.index}` : null);

  const position = "fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-20";
  if (minimized) {
    return (
      <button onClick={() => setMin(false)} className={`${position} flex items-center gap-2 rounded-full bg-white py-1 pr-3 pl-1 text-xs font-medium text-sky-800 shadow-md ring-1 ring-sky-200`}>
        <AuntTallyAvatar size={22} />
        {step ? `Try it: step ${step.index} of ${total}` : "Tour done"}
      </button>
    );
  }

  return (
    <section aria-label={`${ASSISTANT.name}'s tour`} className={`${position} w-[min(20rem,calc(100vw-2rem))] rounded-2xl bg-white p-4 text-sm shadow-xl ring-1 ring-sky-200`}>
      <div className="flex items-start gap-2.5">
        <AuntTallyAvatar size={34} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-sky-700">
            {step ? `Try EvenTally · step ${step.index} of ${total}` : `All ${total} steps done`}
          </p>
          <p className="mt-0.5 font-semibold text-stone-900">{step ? step.title : "You've tried the whole flow!"}</p>
          <p className="mt-1 text-stone-600">
            {step ? step.hint : "Every step is in the activity log, visible to both sides. Reset your demo at the bottom of the page to start over."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Action action={action} pathname={pathname} />
            <form action={hideTour}>
              <button className="text-xs text-stone-500 underline hover:text-stone-800">{step ? "Skip the tour" : "Close"}</button>
            </form>
          </div>
        </div>
        <button onClick={() => setMin(true)} aria-label="Minimize the tour" className="-mt-1 -mr-1 grid size-7 place-items-center rounded-full text-stone-400 hover:bg-stone-100">
          –
        </button>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-sky-100" aria-hidden>
        <div className="h-full rounded-full bg-sky-500" style={{ width: `${(done / total) * 100}%` }} />
      </div>
    </section>
  );
}

/**
 * Once per step and page, bring the glowing element into view if it's off screen. Skips the sticky
 * header (always visible) and copies of earlier pages Next keeps hidden for instant back.
 */
function useScrollToGlow(key: string | null) {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!key || done.current === key) return;
    const timer = setTimeout(() => {
      const target = [...document.querySelectorAll<HTMLElement>(".tour-pulse")].find(
        (el) => el.getClientRects().length > 0 && !el.closest("header"),
      );
      if (!target) return;
      done.current = key;
      const box = target.getBoundingClientRect();
      if (box.top >= 72 && box.bottom <= window.innerHeight - 96) return; // already in view
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    }, 350);
    return () => clearTimeout(timer);
  }, [key]);
}

function Action({ action, pathname }: { action: BubbleAction | null; pathname: string }) {
  const router = useRouter();
  if (!action) return null;
  if (action.kind === "switch") {
    return (
      <form action={switchUser}>
        <input type="hidden" name="userId" value={action.userId} />
        <input type="hidden" name="next" value={action.next} />
        <button className={button}>Switch to {action.name}</button>
        <FormBusy message={`Switching to ${action.name}…`} />
      </form>
    );
  }
  if (action.kind === "aunt") {
    return (
      <button
        type="button"
        className={button}
        onClick={() => {
          // Open the chat on this page if it has one; otherwise go to the ledger, which does.
          if (document.body.dataset.aunt) window.dispatchEvent(new Event(TRY_SAMPLE_EVENT));
          else router.push("/ledger#aunt-claim");
        }}
      >
        Open the chat
      </button>
    );
  }
  if (pathname === action.href.split("#")[0]) return <span className="text-xs font-medium text-sky-800">Press the glowing button on this page.</span>;
  return (
    <Link href={action.href} className={button}>
      Go
    </Link>
  );
}
