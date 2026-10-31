import Link from "next/link";
import { AuntTallyAvatar } from "@/app/components/aunt-tally";
import { FormBusy } from "@/app/components/busy";
import { switchUser } from "@/app/actions";
import { describeEvent } from "@/app/components/event-label";
import { NotificationBell } from "@/app/components/notification-bell";
import { getNotifications } from "@/lib/notifications";
import { getCurrentUser, getDemoUsers } from "@/lib/session";
import { getTour } from "@/lib/tour";
import { formatDateTime } from "@/lib/time";

export async function Header() {
  const [current, users] = await Promise.all([
    getCurrentUser(),
    getDemoUsers(),
  ]);
  const isLandlord =
    users.find((u) => u.id === current?.id)?.role === "landlord";
  const [notifications, tour] = current ? await Promise.all([getNotifications(current), getTour(current)]) : [null, null];
  // When the trial checklist's next step is the other person's, their button glows.
  const switchTo = tour?.next && tour.next.role !== tour.role ? tour.people[tour.next.role].id : null;

  return (
    <header className="sticky top-0 z-20 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-semibold tracking-tight text-stone-900"
        >
          <AuntTallyAvatar size={28} />
          EvenTally
        </Link>
        <nav className="flex gap-4 text-sm text-stone-600">
          {current && (
            <Link href="/ledger" className="hover:text-stone-900">
              Ledger
            </Link>
          )}
          {isLandlord && (
            <Link href="/properties" className="hover:text-stone-900">
              Properties
            </Link>
          )}
        </nav>
        {current && notifications && (
          <div className="ml-auto">
            <NotificationBell
              key={current.id}
              level={current.notify}
              unread={notifications.unread}
              items={notifications.items.map((n) => ({
                id: n.id,
                href: n.href,
                unread: n.unread,
                text: describeEvent(n.event.type, n.event.data),
                when: formatDateTime(n.event.createdAt),
              }))}
            />
          </div>
        )}
        {users.length > 0 && (
          <form
            action={switchUser}
            className={`${current ? "" : "ml-auto "}flex items-center gap-2 text-sm`}
          >
            <span className="text-stone-500">Demo view as</span>
            {users.map((u) => (
              <button
                key={u.id}
                name="userId"
                value={u.id}
                aria-pressed={u.id === current?.id}
                className={`rounded-full border border-stone-300 px-3 py-1 text-stone-700 hover:bg-stone-100 aria-pressed:border-stone-900 aria-pressed:bg-stone-900 aria-pressed:text-white ${u.id === switchTo ? "tour-pulse" : ""}`}
              >
                {u.name.split(" ")[0]}{" "}
                <span className="opacity-70">({u.role})</span>
              </button>
            ))}
            <FormBusy message="Switching…" />
          </form>
        )}
      </div>
    </header>
  );
}
