import { and, asc, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db, schema } from "@/lib/db";
import { getLeasesForUser, roleIn } from "@/lib/ledger";
import type { User } from "@/lib/session";

// The "Try EvenTally" checklist for first-time visitors. Each step is ticked from the demo's own
// events after it was created (the prepared history doesn't count), so nothing extra is stored.
// The step that's next decides which one button on the page pulses.

export const TOUR_COOKIE = "eventally_tour";

type Role = "landlord" | "tenant";
export type TourStepKey = "approve" | "send_invoice" | "pay" | "aunt_claim";
export type TourStep = { key: TourStepKey; role: Role; title: string; hint: string; href: string; done: boolean };
export type Tour = { steps: TourStep[]; next: TourStep | null; role: Role; people: Record<Role, { id: string; firstName: string }> };

/** The tour for this person's demo lease, or null when there's no demo or they hid it. */
export async function getTour(user: User): Promise<Tour | null> {
  if (!user.demoId || (await cookies()).get(TOUR_COOKIE)?.value === "off") return null;
  const [lease] = await getLeasesForUser(user.id);
  const [demo] = await db().select().from(schema.demos).where(eq(schema.demos.id, user.demoId));
  if (!lease?.tenant || !demo) return null;

  const [events, claims] = await Promise.all([
    db()
      .select({ type: schema.events.type, actor: schema.events.actor, data: schema.events.data })
      .from(schema.events)
      .where(and(eq(schema.events.leaseId, lease.id), gt(schema.events.createdAt, demo.createdAt))),
    db().select().from(schema.claims).where(eq(schema.claims.leaseId, lease.id)).orderBy(asc(schema.claims.createdAt)),
  ]);
  const happened = (type: string, test: (e: (typeof events)[number]) => boolean = () => true) => events.some((e) => e.type === type && test(e));
  const sink = claims.find((c) => c.submittedBy === lease.tenantId && c.title === "Kitchen sink leak");
  const tom = lease.landlord.name.split(" ")[0];
  const maya = lease.tenant.name.split(" ")[0];

  const steps: TourStep[] = [
    {
      key: "approve",
      role: "landlord",
      title: `As ${tom}, approve ${maya}'s sink claim`,
      hint: `${maya} paid a plumber; Aunt Tally checked the receipt and photos against the lease.`,
      href: sink ? `/claims/${sink.id}` : "/ledger",
      done: !!sink?.landlordApprovedAt || happened("split.approved", (e) => e.actor === "landlord") || happened("split.proposed", (e) => e.actor === "landlord"),
    },
    {
      key: "send_invoice",
      role: "landlord",
      title: "Send next month's rent invoice through PayPal",
      hint: "Approved repairs are added as credits and charges on the invoice.",
      href: "/ledger#next-invoice",
      done: happened("invoice.sent"),
    },
    {
      key: "pay",
      role: "tenant",
      title: `As ${maya}, pay the invoice`,
      hint: "Pay on PayPal's page, or save your PayPal once and let Aunt Tally pay. The ledger settles itself.",
      href: "/ledger#rent",
      done: happened("invoice.paid"),
    },
    {
      key: "aunt_claim",
      role: "tenant",
      title: "File a new claim by chatting with Aunt Tally",
      hint: "Sample photos of a range hood repair are attached for you.",
      href: "/ledger#aunt-claim",
      done: happened("claim.submitted", (e) => String((e.data as { via?: unknown }).via ?? "").startsWith("Aunt Tally")),
    },
  ];
  return {
    steps,
    next: steps.find((s) => !s.done) ?? null,
    role: roleIn(lease, user.id),
    people: { landlord: { id: lease.landlordId, firstName: tom }, tenant: { id: lease.tenantId!, firstName: maya } },
  };
}

/** True when `key` is the next step and it's this person's to do: its button should pulse. */
export function pulses(tour: Tour | null, key: TourStepKey) {
  return !!tour?.next && tour.next.key === key && tour.next.role === tour.role;
}
