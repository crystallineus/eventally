import { describeEvent } from "@/app/components/event-label";
import { formatDateTime } from "@/lib/time";
import { AuntTallyAvatar } from "@/app/components/aunt-tally";
import { ASSISTANT } from "@/lib/persona";

// An events log showing the latest few entries, with the rest behind "Show more".
// Used for the lease activity log and each claim's history.

const PREVIEW = 3;

const ACTOR_LABEL: Record<string, string> = { landlord: "Landlord", tenant: "Tenant", paypal: "PayPal", system: "System" };

type ActivityEvent = { id: string; type: string; actor: string; data: unknown; createdAt: Date };

export function ActivityList({ events }: { events: ActivityEvent[] }) {
  const rest = events.slice(PREVIEW);
  return (
    <>
      <ActivityItems events={events.slice(0, PREVIEW)} />
      {rest.length > 0 && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-sm font-medium text-sky-700 hover:text-sky-900">
            <span className="group-open:hidden">Show more ({rest.length})</span>
            <span className="hidden group-open:inline">Show less</span>
          </summary>
          <div className="mt-2">
            <ActivityItems events={rest} />
          </div>
        </details>
      )}
    </>
  );
}

function ActivityItems({ events }: { events: ActivityEvent[] }) {
  return (
    <ol className="divide-y divide-stone-100 rounded-2xl bg-white text-sm shadow-card">
      {events.map((e) => (
        <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 sm:flex-nowrap">
          <time className="shrink-0 font-mono text-xs leading-5 text-stone-500" dateTime={e.createdAt.toISOString()}>
            {formatDateTime(e.createdAt)}
          </time>
          {e.actor === "agent" ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs leading-5 text-stone-600">
              <AuntTallyAvatar size={18} />
              {ASSISTANT.name}
            </span>
          ) : (
            <span className="h-5 shrink-0 rounded bg-stone-100 px-1.5 text-xs leading-5 text-stone-600">{ACTOR_LABEL[e.actor] ?? e.actor}</span>
          )}
          {/* On phones the text takes its own line under the time and actor. */}
          <span className="w-full text-stone-800 sm:w-auto">{describeEvent(e.type, e.data)}</span>
        </li>
      ))}
    </ol>
  );
}
