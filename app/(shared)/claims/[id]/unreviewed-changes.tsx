import { formatUsd } from "@/lib/money";
import { ASSISTANT } from "@/lib/persona";
import { formatDateTime } from "@/lib/time";
import { ReviewAgainButton } from "./review-again";

type Role = "landlord" | "tenant";
type Change = { id: string; type: string; data: unknown; createdAt: Date };
type Photo = { id: string; kind: "receipt" | "before" | "after"; uploadedBy: string; at: Date };

const KIND = { receipt: "receipt", before: "before photo", after: "after photo" } as const;

/**
 * Everything that changed after Aunt Tally's latest review, side by side with what she saw: the
 * amount and date before and after, photos added and removed (still shown), who changed what and
 * when, and how many reviews each side can still ask for.
 */
export function UnreviewedChanges({
  claimId,
  reviewedAt,
  changes,
  added,
  removed,
  names,
  people,
  left,
  role,
  canAskAgain,
}: {
  claimId: string;
  reviewedAt: Date;
  changes: Change[];
  added: Photo[];
  removed: Photo[];
  names: Map<string, string>;
  people: Record<Role, string>;
  left: Record<Role, number>;
  role: Role;
  canAskAgain: boolean;
}) {
  const facts = changes.filter((c) => c.type === "claim.amount_changed" || c.type === "claim.date_changed");
  if (!facts.length && !added.length && !removed.length) return null;
  const who = (c: Change) => String((c.data as { by?: string }).by ?? "Someone").split(" ")[0];
  const uploader = (p: Photo) => (names.get(p.uploadedBy) ?? "Someone").split(" ")[0];
  const budget = (r: Role) => {
    const you = r === role;
    if (left[r]) return `${you ? "You" : people[r]} can still ask ${ASSISTANT.name} to review it again (${left[r]} left).`;
    return you ? "You have no reviews left." : `${people[r]} has no reviews left.`;
  };

  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm">
      <h2 className="flex items-center gap-2 font-semibold text-amber-950">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-amber-100 text-xs font-bold text-amber-800" aria-hidden>
          !
        </span>
        Changes {ASSISTANT.name} hasn&apos;t reviewed
      </h2>
      <p className="mt-0.5 text-amber-900">Her review above is based on the claim as of {formatDateTime(reviewedAt)}.</p>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        {facts.map((c) => {
          const d = c.data as { fromCents?: number | null; toCents?: number; from?: string | null; to?: string };
          const [label, from, to] =
            c.type === "claim.amount_changed"
              ? ["Amount", d.fromCents == null ? "not given" : formatUsd(d.fromCents), formatUsd(Number(d.toCents ?? 0))]
              : ["Reported", d.from ?? "not given", d.to ?? ""];
          return (
            <div key={c.id} className="contents">
              <dt className="text-amber-800">{label}</dt>
              <dd className="flex flex-wrap justify-between gap-x-3 text-stone-800">
                <span>
                  <span className="text-stone-500 line-through">{from}</span> → <span className="font-medium">{to}</span>
                </span>
                <span className="text-xs text-stone-500">
                  {who(c)} · {formatDateTime(c.createdAt)}
                </span>
              </dd>
            </div>
          );
        })}
        {(added.length > 0 || removed.length > 0) && (
          <>
            <dt className="text-amber-800">Photos</dt>
            <dd className="flex flex-wrap gap-3">
              {[...added.map((p) => ({ p, gone: false })), ...removed.map((p) => ({ p, gone: true }))].map(({ p, gone }) => (
                <figure key={`${p.id}-${gone}`} className="w-24">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/evidence/${p.id}`} alt={`${KIND[p.kind]} ${gone ? "removed" : "added"}`} className={`h-20 w-24 rounded-md object-cover ring-1 ring-amber-200 ${gone ? "opacity-40 grayscale" : ""}`} />
                  <figcaption className="mt-1 text-xs leading-tight text-stone-600">
                    <span className={`rounded px-1 font-medium ${gone ? "bg-stone-200 text-stone-600" : "bg-amber-200 text-amber-900"}`}>{gone ? "Removed" : "New"}</span>{" "}
                    {KIND[p.kind]}
                    <span className="block text-stone-500">
                      {uploader(p)} · {formatDateTime(p.at)}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </dd>
          </>
        )}
      </dl>

      <div className="mt-4 border-t border-amber-200 pt-3 text-amber-900">
        {/* With the button showing, its own note says how many you have left. */}
        {!(canAskAgain && left[role] > 0) && <p>{budget(role)}</p>}
        <p>{budget(role === "landlord" ? "tenant" : "landlord")}</p>
        {canAskAgain && left[role] > 0 && <ReviewAgainButton claimId={claimId} reviewsLeft={left[role]} />}
      </div>
    </section>
  );
}
