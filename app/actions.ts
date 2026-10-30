"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { parseUsd } from "@/lib/money";
import { markNotificationsSeen, setNotifyLevel, type NotifyLevel } from "@/lib/notifications";
import { DEMO_USER_COOKIE, getDemoUsers, requireUser } from "@/lib/session";

export async function switchUser(formData: FormData) {
  const id = String(formData.get("userId") ?? "");
  // Only people in this visitor's own demo.
  const user = (await getDemoUsers()).find((u) => u.id === id);
  if (!user) redirect("/");
  (await cookies()).set(DEMO_USER_COOKIE, user.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect("/ledger");
}

const usd = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      return parseUsd(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a dollar amount like 2,000.00" });
      return z.NEVER;
    }
  });

const LeaseForm = z.object({
  propertyName: z.string().trim().min(1, "Property name is required"),
  address: z.string().trim().min(1, "Address is required"),
  rent: usd.refine((c) => c > 0, "Rent must be more than $0"),
  deposit: usd.refine((c) => c >= 0, "Deposit can't be negative"),
  dueDay: z.coerce.number().int().min(1).max(28, "Pick a due day between 1 and 28"),
  startDate: z.iso.date("Start date is required"),
  endDate: z.union([z.iso.date(), z.literal("")]),
  repairClause: z.string().trim().min(20, "Paste the lease's repair clause so the agent can cite it"),
  tenantName: z.string().trim().min(1, "Tenant name is required"),
  tenantEmail: z.email("Enter the tenant's email"),
  tenantPaypalEmail: z.union([z.email("Enter a valid PayPal email"), z.literal("")]),
});

export type LeaseFormState = { error: string | null; values?: Record<string, string> };

export async function createLease(_prev: LeaseFormState, formData: FormData): Promise<LeaseFormState> {
  const landlord = await requireUser();
  const values = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)]));
  const parsed = LeaseForm.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message, values };
  const f = parsed.data;

  const leaseId = await db().transaction(async (tx) => {
    // "Inviting" the tenant creates their account; the invite email arrives with Resend later.
    // Tenants are looked up and created inside the landlord's own demo.
    const inDemo = landlord.demoId ? eq(schema.users.demoId, landlord.demoId) : isNull(schema.users.demoId);
    const [existing] = await tx.select().from(schema.users).where(and(eq(schema.users.email, f.tenantEmail), inDemo));
    const tenant =
      existing ??
      (
        await tx
          .insert(schema.users)
          .values({
            demoId: landlord.demoId,
            name: f.tenantName,
            email: f.tenantEmail,
            // In the demo, invoices for a made-up tenant go to the sandbox buyer so they can be paid.
            paypalEmail: f.tenantPaypalEmail || process.env.PAYPAL_SANDBOX_BUYER_EMAIL || f.tenantEmail,
          })
          .returning()
      )[0];
    if (tenant.id === landlord.id) throw new Error("You can't rent to yourself");

    const [lease] = await tx
      .insert(schema.leases)
      .values({
        propertyName: f.propertyName,
        address: f.address,
        landlordId: landlord.id,
        tenantId: tenant.id,
        rentCents: f.rent,
        depositCents: f.deposit,
        dueDay: f.dueDay,
        startDate: f.startDate,
        endDate: f.endDate || null,
        repairClause: f.repairClause,
      })
      .returning();

    await tx.insert(schema.events).values({
      leaseId: lease.id,
      actor: "landlord",
      type: "lease.created",
      data: { landlord: landlord.name, tenant: tenant.name, rentCents: lease.rentCents },
    });
    return lease.id;
  });

  redirect(`/ledger?lease=${leaseId}`);
}

export async function markNotificationsRead() {
  await markNotificationsSeen(await requireUser());
}

export async function saveNotifyLevel(level: NotifyLevel) {
  await setNotifyLevel(await requireUser(), level);
  revalidatePath("/", "layout");
}
