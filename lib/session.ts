import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";

// Demo identity: each visitor has their own demo (lib/demo.ts) and views it as whoever was picked
// in the header switcher. This is the only place that decides who the current user is, so real
// auth can replace it later.
export const DEMO_COOKIE = "eventally_demo";
export const DEMO_USER_COOKIE = "eventally_demo_user";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type User = typeof schema.users.$inferSelect;

/** This visitor's demo, if they have one. */
export async function getDemoId(): Promise<string | null> {
  const id = (await cookies()).get(DEMO_COOKIE)?.value;
  return id && UUID.test(id) ? id : null;
}

export async function getCurrentUser(): Promise<User | null> {
  const [demoId, id] = await Promise.all([getDemoId(), cookies().then((c) => c.get(DEMO_USER_COOKIE)?.value)]);
  if (!demoId || !id || !UUID.test(id)) return null;
  const [user] = await db()
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.id, id), eq(schema.users.demoId, demoId)));
  return user ?? null;
}

/** Everyone in this visitor's demo the header switcher can impersonate, labelled by whether they own any lease. */
export async function getDemoUsers(): Promise<(User & { role: "landlord" | "tenant" })[]> {
  const demoId = await getDemoId();
  if (!demoId) return [];
  const [users, leases] = await Promise.all([
    db().select().from(schema.users).where(eq(schema.users.demoId, demoId)).orderBy(schema.users.createdAt),
    db()
      .select({ landlordId: schema.leases.landlordId })
      .from(schema.leases)
      .innerJoin(schema.users, eq(schema.leases.landlordId, schema.users.id))
      .where(eq(schema.users.demoId, demoId)),
  ]);
  const landlordIds = new Set(leases.map((l) => l.landlordId));
  return users.map((u) => ({ ...u, role: landlordIds.has(u.id) ? "landlord" : "tenant" }));
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}
