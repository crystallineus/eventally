"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { markNotificationsRead, saveNotifyLevel } from "@/app/actions";
import { NOTIFY_LABEL, NOTIFY_LEVELS, type NotifyLevel } from "@/lib/notifications-shared";

type Item = { id: string; href: string; text: string; when: string; unread: boolean };

// The 🔔 in the header: what the other side, Aunt Tally's review, or PayPal did on your leases,
// plus the setting for which of those count.
export function NotificationBell({ items, unread, level }: { items: Item[]; unread: number; level: NotifyLevel }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // The bell sits in the layout, which client navigation doesn't re-render, so remember locally
  // that these were marked read: the badge hides at once, and comes back only for newer items.
  const [readUpTo, setReadUpTo] = useState<string | null>(null);
  const top = items[0]?.id ?? null;
  const badge = readUpTo !== null && readUpTo === top ? 0 : unread;
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  });

  function close() {
    setOpen(false);
    if (readUpTo !== null) router.refresh(); // pick up the read state on the server
  }

  function toggle() {
    if (open) return close();
    setOpen(true);
    // The unread dots stay visible while the panel is open; only the badge clears.
    if (badge > 0) {
      setReadUpTo(top);
      startTransition(() => markNotificationsRead().then(() => undefined));
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-label={badge ? `Notifications, ${badge} new` : "Notifications"}
        aria-expanded={open}
        className="relative grid size-9 place-items-center rounded-full text-stone-600 hover:bg-stone-100"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-semibold leading-5 text-white">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl bg-white text-sm shadow-xl ring-1 ring-stone-200">
          <p className="border-b border-stone-100 px-4 py-2 font-semibold">Notifications</p>
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-stone-500">{level === "off" ? "Notifications are off." : "Nothing new."}</p>
          ) : (
            <ul className="max-h-80 divide-y divide-stone-100 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link href={n.href} onClick={close} className="flex gap-2 px-4 py-2.5 hover:bg-stone-50">
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.unread ? "bg-sky-600" : "bg-transparent"}`} aria-hidden />
                    <span>
                      <span className="block text-stone-800">{n.text}</span>
                      <span className="text-xs text-stone-500">{n.when}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <label className="flex items-center justify-between gap-2 border-t border-stone-100 bg-stone-50 px-4 py-2 text-xs text-stone-600">
            Notify me about
            <select
              defaultValue={level}
              onChange={(e) => startTransition(() => saveNotifyLevel(e.target.value as NotifyLevel))}
              className="rounded border border-stone-300 bg-white px-1.5 py-1 text-xs"
            >
              {NOTIFY_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {NOTIFY_LABEL[l]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
