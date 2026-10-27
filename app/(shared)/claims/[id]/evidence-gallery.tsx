"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { removePhoto, type FormState } from "../actions";

export type Photo = { id: string; kind: "receipt" | "before" | "after"; label: string; alt: string; removable: boolean; isNew: boolean };

const KINDS = [
  { kind: "receipt", title: "Receipt" },
  { kind: "before", title: "Before" },
  { kind: "after", title: "After" },
] as const;

/* eslint-disable @next/next/no-img-element -- photos come from our auth-checked /api/evidence route */

// Evidence thumbnails grouped by kind; clicking one opens a modal viewer that can step
// through every photo on the claim.
export function EvidenceGallery({ claimId, photos }: { claimId: string; photos: Photo[] }) {
  const [removeState, remove, removing] = useActionState<FormState, FormData>(removePhoto, { error: null });
  // Viewer order follows the columns: receipts, then before, then after.
  const ordered = KINDS.flatMap(({ kind }) => photos.filter((p) => p.kind === kind));
  const [index, setIndex] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (index !== null && !d.open) d.showModal();
    if (index === null && d.open) d.close();
  }, [index]);

  const step = (delta: number) => setIndex((i) => (i === null ? i : (i + delta + ordered.length) % ordered.length));
  const current = index === null ? null : ordered[index];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        {KINDS.map(({ kind, title }) => {
          const items = ordered.filter((p) => p.kind === kind);
          return (
            <div key={kind} className="rounded-xl border border-stone-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-medium">{title}</h3>
              {items.length === 0 ? (
                <p className="text-sm text-stone-400">None yet</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {items.map((p) => (
                    <div key={p.id} className="relative">
                      <button
                        type="button"
                        onClick={() => setIndex(ordered.indexOf(p))}
                        className="block w-full overflow-hidden rounded-lg ring-1 ring-stone-200 hover:ring-2 hover:ring-stone-400 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none"
                        aria-label={`View ${p.alt}`}
                      >
                        <img src={`/api/evidence/${p.id}`} alt={p.alt} className="aspect-square w-full object-cover" />
                      </button>
                      {p.isNew && (
                        <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold text-amber-950 shadow">
                          New since AI review
                        </span>
                      )}
                      {p.removable && (
                        <form
                          action={remove}
                          onSubmit={(e) => {
                            if (!confirm("Remove this photo? The file is deleted; the claim history notes that you removed it.")) e.preventDefault();
                          }}
                          className="absolute top-1 right-1"
                        >
                          <input type="hidden" name="claimId" value={claimId} />
                          <input type="hidden" name="evidenceId" value={p.id} />
                          <button
                            disabled={removing}
                            aria-label={`Remove ${p.alt}`}
                            className="grid size-6 place-items-center rounded-full bg-white/90 text-xs text-stone-700 shadow ring-1 ring-stone-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                          >
                            ✕
                          </button>
                        </form>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {removeState.error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {removeState.error}
        </p>
      )}

      <dialog
        ref={dialog}
        onClose={() => setIndex(null)}
        onClick={(e) => e.target === e.currentTarget && setIndex(null)} // click on the backdrop
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
        aria-label="Photo viewer"
        className="m-auto max-h-[92vh] w-[min(64rem,94vw)] overflow-visible rounded-xl bg-transparent p-0 backdrop:bg-black/80"
      >
        {current && (
          <figure className="relative flex flex-col items-center">
            <img
              src={`/api/evidence/${current.id}`}
              alt={current.alt}
              className="max-h-[82vh] w-auto max-w-full rounded-lg bg-white object-contain shadow-2xl"
            />
            <figcaption className="mt-3 text-sm text-white">
              {current.label} · {index! + 1} of {ordered.length}
            </figcaption>
            <button
              type="button"
              onClick={() => setIndex(null)}
              aria-label="Close"
              className="absolute -top-3 -right-3 grid size-9 place-items-center rounded-full bg-white text-lg text-stone-800 shadow hover:bg-stone-100"
            >
              ✕
            </button>
            {ordered.length > 1 && (
              <>
                <NavButton side="left" onClick={() => step(-1)} />
                <NavButton side="right" onClick={() => step(1)} />
              </>
            )}
          </figure>
        )}
      </dialog>
    </>
  );
}

function NavButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous photo" : "Next photo"}
      className={`absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-xl text-stone-800 shadow hover:bg-white ${side === "left" ? "left-2" : "right-2"}`}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
