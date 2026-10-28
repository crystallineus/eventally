import { describeEvent } from "@/app/components/event-label";
import { formatDateTime } from "@/lib/time";

// An events log showing the latest few entries, with the rest behind "Show more".
// Used for the lease activity log and each claim's history.

const PREVIEW = 3;

type ActivityEvent = { id: string; type: string; actor: string; data: unknown; createdAt: Date };

export function ActivityList({ events }: { events: ActivityEvent[] }) {
  const rest = events.slice(PREVIEW);
  return (
    <>
      <ActivityItems events={events.slice(0, PREVIEW)} />
      {rest.length > 0 && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-sm font-medium text-stone-600 hover:text-stone-900">
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
    <ol className="space-y-2 text-sm">
      {events.map((e) => (
        <li key={e.id} className="flex gap-3 rounded-lg bg-white px-4 py-2 ring-1 ring-stone-200">
          <time className="shrink-0 font-mono text-xs leading-5 text-stone-500" dateTime={e.createdAt.toISOString()}>
            {formatDateTime(e.createdAt)}
          </time>
          <span className="shrink-0 rounded bg-stone-100 px-1.5 text-xs leading-5 capitalize text-stone-600">{e.actor}</span>
          <span className="text-stone-800">{describeEvent(e.type, e.data)}</span>
        </li>
      ))}
    </ol>
  );
}
