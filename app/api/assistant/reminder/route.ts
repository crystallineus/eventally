import { eq } from "drizzle-orm";
import { sendReminder } from "@/lib/assistant/chat";
import { db, schema } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

// The landlord pressed Confirm on a reminder Aunt Tally prepared.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  const body = (await request.json().catch(() => null)) as { leaseId?: string; invoiceId?: string; note?: string } | null;
  if (!user || !body?.leaseId || !body.invoiceId) return Response.json({ error: "Bad request" }, { status: 400 });
  const [lease] = await db().select().from(schema.leases).where(eq(schema.leases.id, body.leaseId));
  if (!lease) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    await sendReminder(user, lease, body.invoiceId, String(body.note ?? ""));
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : "Couldn't send the reminder" }, { status: 400 });
  }
}
