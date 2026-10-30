import Link from "next/link";
import { hideTour, switchUser } from "@/app/actions";
import { TourAskAunt } from "@/app/components/tour-ask-aunt";
import type { Tour } from "@/lib/tour";

// "Try EvenTally in 4 steps": the trial checklist on the ledger. The current step explains itself
// and offers one button; when it's the other person's turn, that button switches to them first.
export function TourCard({ tour }: { tour: Tour }) {
  const doneCount = tour.steps.filter((s) => s.done).length;
  return (
    <section aria-label="Try EvenTally" className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-sky-100">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          {tour.next ? `Try EvenTally in ${tour.steps.length} steps` : "You've tried the whole flow"}
          <span className="ml-2 text-sm font-normal text-stone-500">
            {doneCount} of {tour.steps.length} done
          </span>
        </h2>
        <form action={hideTour}>
          <button className="text-sm text-stone-500 underline hover:text-stone-800">Hide</button>
        </form>
      </div>
      {!tour.next && (
        <p className="mt-1 text-sm text-stone-600">
          Every step is in the activity log below, visible to both sides. Reset your demo at the bottom of the page to start over.
        </p>
      )}
      <ol className="mt-3 space-y-2">
        {tour.steps.map((step, i) => {
          const current = step.key === tour.next?.key;
          const other = step.role !== tour.role;
          return (
            <li key={step.key} className={`flex gap-3 rounded-xl px-3 py-2 ${current ? "bg-sky-50" : ""}`}>
              <span
                aria-label={step.done ? "done" : current ? "next" : "to do"}
                className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                  step.done ? "bg-emerald-100 text-emerald-800" : current ? "bg-sky-600 text-white" : "bg-stone-100 text-stone-500"
                }`}
              >
                {step.done ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${step.done ? "text-stone-500 line-through" : "font-medium text-stone-900"}`}>{step.title}</p>
                {current && (
                  <>
                    <p className="mt-0.5 text-sm text-stone-600">{step.hint}</p>
                    <div className="mt-2">
                      {other ? (
                        <form action={switchUser}>
                          <input type="hidden" name="userId" value={tour.people[step.role].id} />
                          <input type="hidden" name="next" value={step.href} />
                          <button className="rounded-full bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
                            Switch to {tour.people[step.role].firstName} →
                          </button>
                        </form>
                      ) : step.key === "aunt_claim" ? (
                        <TourAskAunt />
                      ) : (
                        <Link href={step.href} className="inline-block rounded-full bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
                          Go →
                        </Link>
                      )}
                    </div>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
