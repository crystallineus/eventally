import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";

// Demo identity: whoever was picked in the header switcher. This is the only place
// that decides who the current user is, so real auth can replace it later.
export const DEMO_USER_COOKIE = "eventally_demo_user";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type User = typeof schema.users.$inferSelect;

export async function getCurrentUser(): Promise<User | null> {
  const id = (await cookies()).get(DEMO_USER_COOKIE)?.value;
  if (!id || !UUID.test(id)) return null;
  const [user] = await db().select().from(schema.users).where(eq(schema.users.id, id));
  return user ?? null;
}

/** Everyone the header switcher can impersonate, labelled by whether they own any lease. */
export async function getDemoUsers(): Promise<(User & { role: "landlord" | "tenant" })[]> {
  const [users, leases] = await Promise.all([
    db().select().from(schema.users).orderBy(schema.users.createdAt),
    db().select({ landlordId: schema.leases.landlordId }).from(schema.leases),
  ]);
  const landlordIds = new Set(leases.map((l) => l.landlordId));
  return users.map((u) => ({ ...u, role: landlordIds.has(u.id) ? "landlord" : "tenant" }));
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}
