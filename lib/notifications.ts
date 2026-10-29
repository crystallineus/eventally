import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isNotable, NOTIFY_LEVELS, type NotifyLevel } from "@/lib/notifications-shared";
import type { User } from "@/lib/session";

// Notifications are read straight from the shared events log: anything on your leases done by the
// other side, by Aunt Tally's review, or by PayPal, filtered by your preference. Nothing extra is
// written when something happens, so every action is covered. An email sender (e.g. Resend) can
// later use the same `isNotable` filter and `users.notify` preference.

export { isNotable, NOTIFY_LABEL, NOTIFY_LEVELS, type NotifyLevel } from "@/lib/notifications-shared";

type Role = "landlord" | "tenant";
type Event = typeof schema.events.$inferSelect;

export type Notification = { id: string; event: Event; href: string; unread: boolean };

export async function getNotifications(user: User, limit = 12): Promise<{ items: Notification[]; unread: number }> {
  if (user.notify === "off") return { items: [], unread: 0 };
  const leases = await db()
    .select({ id: schema.leases.id, landlordId: schema.leases.landlordId })
    .from(schema.leases)
    .where(or(eq(schema.leases.landlordId, user.id), eq(schema.leases.tenantId, user.id)));
  if (!leases.length) return { items: [], unread: 0 };
  const roleOf = new Map(leases.map((l) => [l.id, (l.landlordId === user.id ? "landlord" : "tenant") as Role]));

  const since = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  const events = await db()
    .select()
    .from(schema.events)
    .where(and(inArray(schema.events.leaseId, [...roleOf.keys()]), gt(schema.events.createdAt, since)))
    .orderBy(desc(schema.events.createdAt))
    .limit(300);

  const notable = events.filter((e) => isNotable(e, roleOf.get(e.leaseId)!, user.notify));
  const seen = user.notificationsSeenAt?.getTime() ?? 0;
  const items = notable.slice(0, limit).map((event) => ({
    id: event.id,
    event,
    href: event.claimId ? `/claims/${event.claimId}` : `/ledger?lease=${event.leaseId}`,
    unread: event.createdAt.getTime() > seen,
  }));
  return { items, unread: notable.filter((e) => e.createdAt.getTime() > seen).length };
}

export async function markNotificationsSeen(user: User) {
  await db().update(schema.users).set({ notificationsSeenAt: new Date() }).where(eq(schema.users.id, user.id));
}

export async function setNotifyLevel(user: { id: string }, level: NotifyLevel) {
  if (!NOTIFY_LEVELS.includes(level)) throw new Error("Unknown notification setting");
  await db().update(schema.users).set({ notify: level }).where(eq(schema.users.id, user.id));
}
